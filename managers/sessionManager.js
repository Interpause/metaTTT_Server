const sessModule = require("./session");
const EventEmitter = require('events');
const enums = require("./enums");

global.gidList = {};
gidList.allGames = [];
gidList.openGames = [];
gidList.specGames = [];
global.numSessions = 0;

//Local private variables
let database = undefined;	//Currently nedb database, in future maybe some sort of service socket...

//This function will likely change a lot in the future
exports.init = function(db){
	database = undefined;
	database = db;
	return new Promise(callback => db.find({},(err,saves) => {
		let i = 0;
		let chain = Promise.resolve();
		for(let save of saves){
			try{
				//TODO: Private games, better save corruption checking and handling
				//TODO: immediately returning from central database whether it is open and public etc...
				if(save.plyrs.length < save.conf.num_players) gidList.openGames.push(save._id);
				else gidList.specGames.push(save._id);
				gidList.allGames.push(save._id);
				chain = chain.then(() => {return exports.getSess(save._id)}); //TEMP Forcefully caches everything
				i++;
			}catch(e){
				console.log(`Session ${save._id} is corrupted!`);
			}
		}
		numSessions = i;
		console.log(`${numSessions} sessions in database.`);
		chain.then(() => callback(err));
	}));
};

//Currently means server uses 2x more ram than necessary, but integral to scalable approach in future.
//Cache must tightly be kept to only active sessions on the server.
let sessCache = {};
let cacheList = [];
function checkInit(){
	if(database == undefined){
		sessCache = {};
		cacheList = [];
		throw new Error("Database not initiated!");
	}
}

//Returns a promise that resolves to the gameState, of course this being a reference to the actual thing
exports.getSess = function(id){
	checkInit();
	if(id == null) return Promise.reject(new Error("Missing session id in param"));
	if(sessCache[id] == undefined){
		return new Promise((callback,reject) => database.find({_id:id},(err,save) => {
			if(save.length == 0){
				//console.log(`Error ${enums.unfound}: ${id}`);
				//reject(new Error(enums.unfound));
				callback(enums.unfound);
			}else{
				let game = Object.assign(new EventEmitter(),sessModule.createSession());
				sessModule.restoreSession(game,save[0]);
				sessModule.start(game);
				exports.pushSess(id,game);
				callback(sessCache[id]);
			}
		}));
	}else return Promise.resolve(sessCache[id]);
}

//Creates session (for now syncDatabase saves it, in the future might need to syncSpecificDb)
exports.createSess = function(gconf){
	checkInit();
	gconf = (gconf==null)? sessModule.gconf : gconf;
	let game = Object.assign(new EventEmitter(),sessModule.createSession());
	sessModule.init(game,gconf);
	return new Promise((callback,reject) => database.insert(game.state, (err, newDoc) => {
		if(err != null){
			console.log("Unable to insert Session?");
			reject(new Error(err));
			return;
			//TODO  MORE
		}
		exports.pushSess(newDoc._id,game);
		numSessions++;
		console.log(`Session ${newDoc._id} created.`);
		callback(newDoc._id);
	}));
}

//Adds a session and sessionManager handlers for when it is deleted (playerManager will add its own too).
exports.pushSess = function(id,sess){
	checkInit();
	//sess.isPublic and accompanying lists are currently undefined (TODO)
	cacheList.push(id);
	sessCache[id] = sess;
	gidList.allGames.push(id);
	if(sess.isStarted) gidList.specGames.push(id);
	else if(!sess.isStarted) gidList.openGames.push(id);
	
	//Handler for sessionManager for deletion of session.
	sess.on(enums.ended, () => {
		ind1 = gidList.allGames.indexOf(id);
		if(ind1 != -1) gidList.allGames.splice(ind1,1);
		ind2 = gidList.openGames.indexOf(id);
		if(ind2 != -1) gidList.openGames.splice(ind2,1);
		ind3 = gidList.specGames.indexOf(id);
		if(ind3 != -1) gidList.specGames.splice(ind3,1);
		database.remove({_id:id}); //TODO reason for removal.
		ind4 = cacheList.indexOf(id);
		if(ind4 != -1) cacheList.splice(ind4,1);
		delete sessCache[id];
		console.log(`Session ${id} removed.`);
		numSessions--;
	});
	
	//Handler for game becoming full and starting.
	sess.on(enums.started, () => {
		ind5 = gidList.openGames.indexOf(id);
		if(ind5 != -1) gidList.openGames.splice(ind5,1);
		gidList.specGames.push(id); //TODO private games
		sessModule.start(sess);
		console.log(`Session ${id} started.`);
	});
	
	//Handler for move being made.
	sess.on(enums.move, (pid,move) => {
		sessModule.setInput(sess,pid,move).catch(e => {
			//console.log(`${e.name}: ${pid} ${enums.move} ${move}`);
		})
	});
}

//Updates central database.
exports.updateSess = function(id){
	checkInit();
	if(cacheList.indexOf(id) == -1) return;
	else if(sessCache[id].players.length == 0) sessCache[id].emit(enums.ended);
	else if(sessCache[id].state.winner != -1) sessCache[id].emit(enums.ended);
	else database.update({_id:id},sessCache[id].state);
}

//Syncs with database. Fine to send whole cache as this should consist only active sessions in the future.
exports.syncDatabase = function(){
	try{
		checkInit();
	}catch(e){
		return;
	}
	for(let id of cacheList){
		exports.updateSess(id);
		//TODO Triggered by AWS service as well?
	}
	//TODO function that checks and downloads global server
}
setInterval(exports.syncDatabase,25000); //30s

//Adds player/spectator to game.
exports.joinSess = function(id,pid){
	checkInit();
	if(gidList.allGames.indexOf(id) == -1) return Promise.reject(new Error(enums.unfound));
	return exports.getSess(id).then(game => {
		if(game == enums.unfound) return enums.unfound;
		if(game.players.indexOf(pid) != -1) return game;
		if(game.isStarted){
			if(game.specs.indexOf(pid) == -1) sessModule.addSpec(game,pid);
			console.log(`Player ${pid} added to session ${id} as spectator.`);
			return game;
		}else{
			sessModule.addPlayer(game,pid);
			console.log(`Player ${pid} added to session ${id} as player.`);
			if(game.numPlys == game.maxPlys) game.emit(enums.started);
			return game;
		}
	});
}

exports.getInfo = function(sess){
	return sessModule.getInfo(sess);
}
