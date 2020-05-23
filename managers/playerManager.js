const Filter = require("bad-words");
const EventEmitter = require('events');
let filter = new Filter();

const enums = require("./enums");
const agents = require("./agents");

global.pidList = [];
global.numPlayers = 0;
let socks = {}; //Open response objects used in long polling

//Local private variables
let database = undefined;	//Currently nedb database, in future maybe some sort of service socket...

//This function will likely change a lot in the future
exports.init = function(db){
	database = undefined;
	database = db;
	return new Promise(callback => db.find({},(err,profiles) => {
		let i = 0;
		let chain = Promise.resolve();
		for(let profile of profiles){
			pidList.push(profile._id);
			chain = chain.then(() => {return exports.getPlayer(profile._id)}); //TEMP Forcefully caches everything
			//TODO session calls turn on resume! if(profile.bot) profile.gidList.forEach(gid => chain = chain.then(() => return exports.runAI(profile._id,gid)));
			i++;
		}
		numPlayers = i;
		if(pidList.indexOf('minMax') == -1) exports.newPlayer('minMax','simpBot','pleasedontguessme',true);
		console.log(`${numPlayers} players in database.`);
		chain.then(() => callback(err));
	}));
};

//Currently means server uses 2x more ram than necessary, but integral to scalable approach in future.
//Cache must tightly be kept to only active sessions on the server.
let pidCache = {};
let cacheList = [];
function checkInit(){
	if(database == undefined){
		pidCache = {};
		cacheList = [];
		throw new Error("Database not initiated!");
	}
}

//Joins player into session and adds all relevant handlers to sess.
exports.joinSess = function(id,gid,sess){	
	if(sess.pManagerAdded != true){
		//Handler for when game starts. Triggers enums.turn event.
		sess.on(enums.started, () => sess.emit(enums.turn)); //TODO smth more
		
		//Handler for when move is made. Triggers enums.turn later. Waits for input to be set first.
		sess.on(enums.move, (pid,move) => setTimeout(() => sess.emit(enums.turn),5)); 
		
		//Handler to update. Sends session to all players, triggering AI as well.
		sess.on(enums.turn, () => {
			let chain = Promise.resolve();
			let names = [];
			sess.players.forEach(pid => chain = chain.then(() => exports.getPlayer(pid).then(profile => names.push(profile.name))));
			
			chain.then(() => {
				let cont = {};
				cont[enums.onlineGame] = Object.assign({},sess.state);
				cont[enums.onlineGame].names = names;
				cont.gid = gid;
				sess.specs.forEach(watcher => {
					if(watcher == "minMax") exports.runAI(watcher,sess);
					exports.usePlayerPoll(watcher,cont)
				});
			});
		});
	}
	sess.pManagerAdded = true;
	
	//Handler to remove gid from player profile when it ends.
	if(sess.players.indexOf(id) != -1) exports.getPlayer(id).then(profile => {
		profile.gidList.push(gid);
		sess.on(enums.ended, () => {
			profile.gidList.splice(profile.gidList.indexOf(gid),1);
			//TODO usePlayerPoll to send smth here?
		});
	});
	exports.getPlayer(id).then(profile => profile.eventList = []);
	sess.emit(enums.turn);
}

//Gets player from central database
exports.getPlayer = function(id){
	checkInit();
	if(id == null) return Promise.reject(new Error("Missing player id in param"));
	if(pidCache[id] == undefined){
		return new Promise((callback,reject) => database.find({_id:id},(err,save) => {
			if(save.length == 0) reject(new Error(enums.unfound));
			else{
				pidCache[id] = save[0];
				cacheList.push(id);
				callback(pidCache[id]);
			}
		}));
	}else return Promise.resolve(pidCache[id]);
}

//Adds a new player.
exports.newPlayer = function(id,name,passwd,fake){
	checkInit();
	if(pidList.indexOf(id) > -1){
		console.log(`PID ${id} violated.`);
		return;
	}
	pidList.push(id);
	pidCache[id] = {
		gidList: [],
		eventList: [],
		wins: 0,
		name: filter.clean(name),
		bot: (fake==true),
		score: 0,
		passwd: passwd,
		_id: id
	};
	database.insert(pidCache[id]);
	console.log(`New device ${id} added as player.`);
	numPlayers++;
}

//Adds long poll into socks (poll cache)
exports.addPlayerPoll = function(id,res){
	res.setTimeout(4750,() => { // Timeout (15s) is not actually necessary.
		let cont = {};
		cont[enums.openPoll] = enums.busy;
		res.write(JSON.stringify(cont));
		res.end();
	});
	res.on('close', () => {
		res.end();
		delete socks[id];
	});
	res.on('finish', () => delete socks[id]);
	if(socks[id] != null && !socks[id].finished){
		let cont = {};
		cont[enums.openPoll] = enums.busy;
		socks[id].write(JSON.stringify(cont));
		socks[id].end();
	}
	socks[id] = res;
	exports.getPlayer(id).then(profile => {
		if(profile.eventList.length > 0) exports.usePlayerPoll(id,profile.eventList.shift(),true);
	});
}

//Uses long poll for player.
exports.usePlayerPoll = function(id, msg, isRet){
	let res = socks[id];
	if(res != null && !res.finished){
		res.write(JSON.stringify(msg));
		res.end();
	}else if(isRet == true) exports.getPlayer(id).then(profile => profile.eventList.unshift(msg));
	else exports.getPlayer(id).then(profile => profile.eventList.push(msg));
}

//Runs AI bot given id of bot and session.
exports.runAI = function(id, sess){
	if(id != "minMax") return;
	exports.getPlayer(id).then(profile => {
		if(!profile.bot) return;
		if(sess.aiProc) return;
		let game = sess.state;
		if(game.plyrs[game.plyr] != id || game.winner != -1) return;
		sess.aiProc = true;
		agents[id](game,null,game.plyr).then(suggestion => {
			sess.emit(enums.move,id,suggestion[0]);
			sess.aiProc = false;
		});
	});
}

exports.syncDatabase = function(){
	try{
		checkInit();
	}catch(e){
		return;
	}
	for(let id of cacheList){
		database.update({_id:id},pidCache[id]);
		//TODO Triggered by AWS service as well?
	}
	//TODO function that checks and downloads global server
}
setInterval(exports.syncDatabase,25000); //25s

