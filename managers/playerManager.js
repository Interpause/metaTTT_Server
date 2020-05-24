const filter = new (require("bad-words"))();
const EventEmitter = require('events');

const enums = require("../common/utils/enums");
const agents = require("../gameAI/agents");

global.pidList = [];
global.numPlayers = 0;

//Local private variables
let database = undefined;	//Currently nedb connection
let socks = {};

let algos = {'minMax':'simpBot','abMinMax':'ababot'};

//This function will likely change a lot in the future
module.exports.init = async function(db){
	database = db;
	let error = null;
	await new Promise(resolve => {
		db.find({},async (err,profiles) => {
			numPlayers = 0;
			error = err;
			for(let profile of profiles){
				pidList.push(profile._id);
				await module.exports.getPlayer(profile._id); //TEMP Forcefully caches everything
				//if(profile.bot) profile.gidList.forEach(gid => chain = chain.then(() => return exports.runAI(profile._id,gid)));
				numPlayers++;
			}
			for(let [algo,name] of Object.entries(algos)) if(pidList.indexOf(algo) == -1) module.exports.newPlayer(algo,name,'pleasedontguessme',true);
			resolve();
		});
	});
	console.log(`${numPlayers} players in database.`);
	return error; //may just be empty
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

module.exports.addPlayerWS = function(pid,sock){
	let old = socks[pid];
	if(old != null) old.close();

	let emitter = new EventEmitter();
	sock.onmessage = raw => {
        let msg = JSON.parse(raw.data);
        if(Array.isArray(msg)) msg.forEach(event => emitter.emit(event.event,event.data));
        else emitter.emit(msg.event,msg.data);
	}
	sock.onclose = e => {
		sock.close();
		emitter.removeAllListeners();
		sock = null;
		emitter = null;
	}
	emitter.on(enums.disconnect,data => sock.close());
	emitter.pid = pid;
	socks[pid] = sock;
	return emitter;
}

module.exports.sendPlayer = function(pid,event,data){
	if(socks[pid] == null) return;
	socks[pid].send(JSON.stringify({
		'event':event,
		'data':data
	}));
}

module.exports.getNamesFromIds = async function(pids){
	let names = [];
	for(let pid of pids){
		let profile = await module.exports.getPlayer(pid);
		names.push(profile.name);
	}
	return names;
}

//Joins player into session and adds all relevant handlers to sess.
module.exports.joinSess = function(id,gid,sess){	
	if(sess.pManagerAdded != true){
		//Handler for when game starts. Triggers enums.turn event.
		sess.on(enums.started, () => sess.emit(enums.turn)); //TODO smth more
		
		//Handler for when move is made. Triggers enums.turn later. Waits for input to be set first.
		sess.on(enums.move, (pid,move) => wait(5).then(() => sess.emit(enums.turn))); 
		
		//Handler to update. Sends session to all players, triggering AI as well.
		sess.on(enums.turn, async () => {
			let names = await module.exports.getNamesFromIds(sess.player_ids);
			let cont = {};
			cont = JSON.parse(JSON.stringify(sess.state));
			cont.names = names; //TODO: pid based retrieval by client
			cont.gid = gid;
			sess.spectators.forEach(watcher => {
				if(algos[watcher] != null) module.exports.runAI(watcher,sess);
				else module.exports.sendPlayer(watcher,enums.updateState,cont);
			});
		});
		sess.pManagerAdded = true;
	}
	
	//Handler to remove gid from player profile when it ends.
	if(sess.player_ids.indexOf(id) != -1) module.exports.getPlayer(id).then(profile => {
		profile.gidList.push(gid);
		sess.on(enums.ended, () => {
			profile.gidList.splice(profile.gidList.indexOf(gid),1);
			//TODO send victory message here?
		});
	});
	module.exports.getPlayer(id).then(profile => profile.eventList = []);
	sess.emit(enums.turn);
}

//Gets player from central database
module.exports.getPlayer = async function(id){
	checkInit();
	if(id == null) throw new Error("Missing player id in param");
	if(pidCache[id] == undefined){
		await new Promise(resolve => {
			database.find({_id:id},(err,save) => {
				if(save.length == 0) throw new Error(enums.unfound);
				pidCache[id] = save[0];
				cacheList.push(id);
				resolve();
		})
	});
	}
	return pidCache[id];
}

//Adds a new player.
module.exports.newPlayer = function(id,name,passwd,fake){
	checkInit();
	if(pidList.indexOf(id) > -1) return console.log(`PID ${id} violated.`);
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

//Runs AI bot given id of bot and session.
module.exports.runAI = function(id, sess){
	module.exports.getPlayer(id).then(profile => {
		if(!profile.bot) return;
		if(sess.aiProc) return;
		let game = sess.state;
		if(game.cur_player != id || game.winner != null) return;
		sess.aiProc = true;
		agents[id](game,null,game.cur_player_ind).then(suggestion => {
			sess.emit(enums.move,id,suggestion[0]);
			sess.aiProc = false;
		});
	});
}

module.exports.syncDatabase = function(){
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
setInterval(module.exports.syncDatabase,25000); //25s