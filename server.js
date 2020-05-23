const http = require('http');
const nedb = require('nedb');

const enums = require("./utils/enums");
const sessManager = require("./managers/sessionManager");
const playerManager = require("./managers/playerManager");

//Adds player to session.
function joinSession(gid,pid){
	return sessManager.joinSess(gid,pid).then(game => {
		if(game == enums.unfound) return;
		playerManager.joinSess(pid,gid,game);
	});
}

//Helper function
function genRandIndex(num,length){
	if(length <= num) return [...Array(length).keys()];
	let done = [];
	while(done.length != num){
		let i = Math.floor(Math.random() * length);
		if(done.indexOf(i) == -1 && !isNaN(i)) done.push(i);
	}
	return done;
}

//Gets info about session open for spectating
function getSpecSessions(pid){
	//TODO find spectator games based on skill level or popularity of players?
	let info = {};
	let chain = Promise.resolve();
	let inds = genRandIndex(6,gidList.specGames.length); //6 is client limit rn
	for(let ind of inds){
		chain = chain.then(() => {
			return getSessInfo(gidList.specGames[ind],true,pid).then(sessInfo => {
				
				if(sessInfo != null) info[gidList.specGames[ind]] = sessInfo;
			});
		});
	}
	return chain.then(() => {return info});
}

//Finds open session for player to join
function getOpenSession(pid){
	//TODO player score matching system
	if(gidList.openGames.length < 1){
		return sessManager.createSess().then(gid => {
			setTimeout(() => {
				if(gidList.openGames.indexOf(gid) != -1) joinSession(gid,"minMax");
			},5000); //Wait 5s for AI to join match.
			return gid;
		});
	}else return Promise.resolve(gidList.openGames[0]);
}

//Finds joined game data for player
function getJoinedSessions(pid){
	return playerManager.getPlayer(pid).then(profile => {
		let info = {};
		let chain = Promise.resolve();
		for(let gid of profile.gidList){
			chain = chain.then(() => {
				return getSessInfo(gid).then(sessInfo => {
					if(sessInfo != null) info[gid] = sessInfo;
				});
			});
		}
		return chain.then(() => {return info});
	});
}

//Gets info of a session
function getSessInfo(gid,isSpec,pid){
	return sessManager.getSess(gid).then(sess => {
		let chain = Promise.resolve();
		if(sess == enums.unfound) return chain;
		if(!sess.isStarted) return chain; //TODO: what about private match selection screen?
		if(isSpec == true && sess.players.indexOf(pid) != -1) return chain;
		
		let info = sessManager.getInfo(sess);
		info.names = [];
		for(let pid of sess.players){
			chain = chain.then(() => {
				return playerManager.getPlayer(pid).then(profile => info.names.push(profile.name));
			});
		}
		return chain.then(() => {return info});
	});
}

//TODO put all the crash handlers and data attribute verifiers here.
function checkData(req,res,rdata){
	let data = JSON.parse(rdata);
		
	res.setHeader('Content-Type','application/json');
	res.setHeader('Access-Control-Allow-Origin','*');
	res.writeHead(200);
	
	let cont = {};
	if(data.cmd == null || data.pid == null || data.passwd == null){ //sanity check
		cont[enums.error] = enums.error;
		res.write(JSON.stringify(cont));
		res.end();
		return;
	}
	
	if(data.gid != null){
		if(gidList.allGames.indexOf(data.gid) == -1){
			cont[data.cmd] = enums.error;
			res.write(JSON.stringify(cont));
			res.end();
			return;
		}
	}
	
	if(pidList.indexOf(data.pid) == -1) playerManager.newPlayer(data.pid,data.name,data.passwd);
	playerManager.getPlayer(data.pid).then(profile => {
		if(profile.passwd != data.passwd){
			let ip_addr = req.headers['x-forwarded-for'];
			if(ip_addr == null) ip_addr = req.connection.remoteAddress;
			console.log(`${ip_addr} violated ${data.pid} account!`);
			cont[enums.sessionMenu] = enums.error;
			res.write(JSON.stringify(cont));
			res.end();
		}else{
			profile.name = data.name;
			processData(req,res,data,profile);
		}
	});
}

//Process data.
function processData(req,res,data,profile){
	let chain = Promise.resolve();
	let cont = {};
	switch(data.cmd){
		case enums.getSessions:
			chain = chain.then(() => {return getJoinedSessions(data.pid).then(info => {
				cont[enums.sessionMenu] = info;
			})});
			break;
			
		case enums.findSession:
			//TODO invite matches
			chain = chain.then(() => {return getOpenSession(data.pid).then(gid => cont[enums.findingSession] = gid)});
			break;
		case enums.getSpecSessions:
			chain = chain.then(() => {return getSpecSessions(data.pid).then(info => {
				cont[enums.spectatorMenu] = info;
			})});
			break;
		
		case enums.createSession:
			//TODO
			break;
		
		case enums.move:
			chain = chain.then(() => {
				return sessManager.getSess(data.gid).then(sess => {
					if(sess == enums.unfound) cont[enums.move] = enums.error;
					else{
						sess.emit(enums.move,data.pid,data.move);
						cont[enums.move] = enums.okay;
					}
				});
			});
			break;
		
		case enums.openPoll:
			playerManager.addPlayerPoll(data.pid,res);
			return;
		
		case enums.join:
			chain = chain.then(() => {return joinSession(data.gid,data.pid).then(() => cont.gid = data.gid)});
			break;
		
		case enums.leave:
			chain = chain.then(() => {return sessManager.getSess(data.gid).then(sess => {
				if(sess.players.indexOf(data.pid) != -1){
					sess.emit(enums.ended);
					cont[enums.leave] = enums.okay;
				}else cont[enums.leave] = enums.error;
			})});
			break;
			
		default:
			cont[data.cmd] = enums.error;
			break;		
	}
	chain.then(() => {
		res.write(JSON.stringify(cont));
		res.end();
	});
	return;
}

function onPOST(req,res){
	let rdata = "";
	req.on('data', raw => rdata += raw);
	req.on('end',() => {
		if(!req.complete){
			res.writeHead(400);
			res.end();
			return;
		}	
		checkData(req,res,rdata);
	});
}

function onRequest(req,res){
	try{
		switch(req.method){
			case 'POST':
				onPOST(req,res);
				break;
			case 'OPTIONS':
				req.resume();
				res.setHeader('Access-Control-Allow-Origin','*');
				res.setHeader('Access-Control-Allow-Headers','Content-Type');
				res.writeHead(200);
				res.end();
				break;
			default:
				req.resume();
				res.writeHead(400);
				res.end();
				break;
		}
	}catch(e){
		console.log(e);
		res.end();
	}
	return;
}

function startServer(){
	server = http.createServer(onRequest);
	setTimeout(() => {
		sessManager.init(new nedb({filename:'./games.db',autoload:true})).then(() => {
			playerManager.init(new nedb({filename:'./players.db',autoload:true})).then(() => {
				//server.listen(8080,"ec2-52-207-243-99.compute-1.amazonaws.com",()=>{console.log("Listening.");});
				server.listen(8080,"localhost",()=>{console.log("Listening.");});
			});
		});
	},300);	
}

function cleanup() {
    //TODO usePlayerPoll to tell all that server is closing.
	let chain = Promise.resolve();
	for(let gid of gidList.openGames) chain = chain.then(() => {
		return sessManager.getSess(gid).then(sess => sess.emit(enums.ended));
	});
	chain.then(() => {
		playerManager.syncDatabase();
		sessManager.syncDatabase();
	});	
}

process.stdin.resume();
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(0));
process.on('SIGUSR1', () => process.exit(0));
process.on('SIGUSR2', () => process.exit(0));
process.on('uncaughtException', (e) => {
	console.log(e.stack);
	process.exit(0);
});

startServer();