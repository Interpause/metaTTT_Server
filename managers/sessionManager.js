const Session = require("../common/classes/session");
const enums = require("../common/utils/enums");
const gconf = require("../common/utils/game_config");

global.gidList = {};
gidList.allGames = [];
gidList.openGames = [];
gidList.specGames = [];
global.numSessions = 0;

//Local private variables
let database = undefined;	//Currently nedb database, in future maybe some sort of service socket...

//This function will likely change a lot in the future
module.exports.init = async function(db){
	database = db;
	let error = null;
	await new Promise(resolve => {
		db.find({},async (err,saves) => {
			numSessions = 0;
			for(let save of saves){
				try{
					//TODO: Private games, better save corruption checking and handling
					//TODO: immediately returning from central database whether it is open and public etc...
					if(save.player_ids.length < save.config.num_players) gidList.openGames.push(save._id);
					else gidList.specGames.push(save._id);
					gidList.allGames.push(save._id);
					await module.exports.getSess(save._id); //TEMP Forcefully caches everything
					numSessions++;
				}catch(e){
					console.log(`Session ${save._id} is corrupted!`);
				}
			}
			error = err;
			resolve();
		});
	});
	console.log(`${numSessions} sessions in database.`);
	return error;
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
module.exports.getSess = async function(id){
	checkInit();
	if(id == null) throw new Error("Missing session id in param");
	if(sessCache[id] == undefined){
		await new Promise(resolve => {
			database.find({_id:id},(err,save) => {
				if(save.length == 0) sessCache[id] = enums.unfound;
				else{
					let game = new Session();
					game.restoreSession(save[0]);
					game.start();
					module.exports.pushSess(id,game);
				}
				resolve();
		})
	});
	}
	return sessCache[id];
}

//Creates session (for now syncDatabase saves it, in the future might need to syncSpecificDb)
exports.createSess = function(gconfig){
	checkInit();
	gconfig = (gconfig==null)? gconf : gconfig;
	let game = new Session();
	game.init(gconf);

	return new Promise((callback,reject) => database.insert(JSON.parse(JSON.stringify(game.state)), (err, newDoc) => {
		if(err != null){
			console.log("Unable to insert Session?");
			reject(new Error(err));
			return;
			//TODO  MORE
		}
		module.exports.pushSess(newDoc._id,game);
		numSessions++;
		console.log(`Session ${newDoc._id} created.`);
		callback(newDoc._id);
	}));
}

//Adds a session and sessionManager handlers for when it is deleted (playerManager will add its own too).
module.exports.pushSess = function(id,sess){
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
		sess.start();
		console.log(`Session ${id} started.`);
	});
	
	//Handler for move being made.
	sess.on(enums.move, (pid,move) => {
		try{
			sess.setInput(pid,move);
		}catch(e){
			//console.log(`${e.name}: ${pid} ${enums.move} ${move}`);
		}
	});
}

//Updates central database.
module.exports.updateSess = function(id){
	checkInit();
	if(cacheList.indexOf(id) == -1) return;
	else if(sessCache[id].player_ids.length == 0) sessCache[id].emit(enums.ended);
	else if(sessCache[id].state.winner != null) sessCache[id].emit(enums.ended);
	else database.update({_id:id},sessCache[id].state);
}

//Syncs with database. Fine to send whole cache as this should consist only active sessions in the future.
module.exports.syncDatabase = function(){
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
setInterval(module.exports.syncDatabase,25000); //30s

//Adds player/spectator to game.
module.exports.joinSess = async function(id,pid){
	checkInit();
	if(gidList.allGames.indexOf(id) == -1) throw new Error(enums.unfound);
	let game = await exports.getSess(id);
	if(game == enums.unfound) return enums.unfound;
	if(game.player_ids.indexOf(pid) != -1) return game;
	if(game.isStarted){
		if(game.spectators.indexOf(pid) == -1) game.addSpectator(pid);
		console.log(`Player ${pid} added to session ${id} as spectator.`);
	}else{
		game.addPlayer(pid);
		console.log(`Player ${pid} added to session ${id} as player.`);
		if(game.num_players == game.max_players) game.emit(enums.started);
	}
	return game;
}

module.exports.getInfo = function(sess){
	return sess.getInfo();
}
