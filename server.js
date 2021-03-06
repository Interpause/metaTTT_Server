const enums = require("./common/utils/enums");
const sessManager = require("./managers/sessionManager");
const playerManager = require("./managers/playerManager");
require("./common/utils/utils");

const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const nedb = require('nedb');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({noServer: true});

function genRandIndex(num,length){ //Helper function
	if(length <= num) return [...Array(length).keys()];
	let done = [];
	while(done.length != num){
		let i = Math.floor(Math.random() * length);
		if(done.indexOf(i) == -1 && !isNaN(i)) done.push(i);
	}
	return done;
}

//Adds player to session.
async function joinSession(gid,pid){
	let game = await sessManager.joinSess(gid,pid);
	if(game == enums.unfound) return;
	playerManager.joinSess(pid,gid,game);
	return game;
}

//Gets info about session open for spectating
async function getSpecSessions(pid){
	//TODO find spectator games based on skill level or popularity of players?
	let info = {};
	let inds = genRandIndex(6,gidList.specGames.length); //6 is client limit rn
	for(let ind of inds){
		let sessInfo = await getSessInfo(gidList.specGames[ind],true,pid);
		if(sessInfo != null) info[gidList.specGames[ind]] = sessInfo;
	}
	return info;
}

//Finds open session for player to join
async function getOpenSession(pid){
	//TODO player score matching system
	if(gidList.openGames.length < 1){
		let gid = await sessManager.createSess();
		wait(5000).then(() => { //Wait 5s for AI to join match.
			if(gidList.openGames.indexOf(gid) != -1) joinSession(gid,"minMax");
			//if(gidList.openGames.indexOf(gid) != -1) joinSession(gid,"abMinMax");
		});
		return gid;
	}else return gidList.openGames[0];
}

//Finds joined game data for player
async function getJoinedSessions(pid){
	let profile = await playerManager.getPlayer(pid);
	let info = {};
	for(let gid of profile.gidList){
		let sessInfo = await getSessInfo(gid);
		if(sessInfo != null) info[gid] = sessInfo;
	}
	return info;
}

//Gets info of a session
async function getSessInfo(gid,isSpec,pid){
	let sess = await sessManager.getSess(gid);
	if(sess == enums.unfound) return;
	if(!sess.isStarted) return; //TODO: what about private match selection screen?
	if(isSpec == true && sess.player_ids.indexOf(pid) != -1) return;
	let info = await sessManager.getInfo(sess);
	info.names = await playerManager.getNamesFromIds(sess.player_ids);
	return info;
}

//TODO: logging and crashing
function registerClientEvents(client){
	client.on(enums.getSessions,async (data) => {
		let info = await getJoinedSessions(client.pid);
		playerManager.sendPlayer(client.pid,enums.getSessions,info);
	});
	client.on(enums.getSpecSessions,async (data) => {
		let info = await getSpecSessions(client.pid);
		playerManager.sendPlayer(client.pid,enums.getSpecSessions,info);
	});

	client.on(enums.findSession,async (data) => {
		//TODO invite matches
		let gid = await getOpenSession(client.pid);
		playerManager.sendPlayer(client.pid,enums.findSession,gid);
	});
	client.on(enums.createSession,async (data) => {}); //TODO

	client.on(enums.move,async (data) => {
		let sess = await sessManager.getSess(data.gid);
		if(sess == enums.unfound) return playerManager.sendPlayer(client.pid,enums.move,enums.error);
		sess.emit(enums.move,client.pid,data.move);
		playerManager.sendPlayer(client.pid,enums.move,enums.okay);
	});

	client.on(enums.join,async (data) => {
		let sess = await joinSession(data.gid,client.pid);
		playerManager.sendPlayer(client.pid,enums.join,enums.okay);
		sess.emit(enums.turn);//forcefully sends broadcast
	});

	client.on(enums.leave,async (data) => {
		let sess = await sessManager.getSess(data.gid);
		if(sess.player_ids.indexOf(client.pid) != -1){
			sess.emit(enums.ended);
			playerManager.sendPlayer(client.pid,enums.leave,enums.okay);
		}else playerManager.sendPlayer(client.pid,enums.leave,enums.error);
	});
}

//Client connection made
server.on('upgrade',(req,sock,head) => wss.handleUpgrade(req,sock,head,ws => wss.emit('connection',ws)));
wss.on("connection", ws =>{
	//"Authentication"
	ws.send(JSON.stringify({'event':enums.connect}));
	ws.once('message',async (raw) => {
		let data = JSON.parse(raw).data;
		if(data == null) return ws.close();
		if(pidList.indexOf(data.pid) == -1) playerManager.newPlayer(data.pid,data.name,data.passwd);
		
		let profile = await playerManager.getPlayer(data.pid);
		if(profile.passwd != data.passwd){
			let ip_addr = ws._socket.remoteAddress;
			console.log(`${ip_addr} violated ${data.pid} account!`);
			return ws.close();
		}
		
		registerClientEvents(playerManager.addPlayerWS(data.pid,ws));
		playerManager.sendPlayer(data.pid,enums.okay);
	});
});

async function startServer(){
	await sessManager.init(new nedb({filename:'./.data/games.db',autoload:true}));
	await playerManager.init(new nedb({filename:'./.data/players.db',autoload:true}));
	server.listen(process.env.PORT);
	console.log("Listening");
}

function cleanup() {
	playerManager.syncDatabase();
	sessManager.syncDatabase();
	return;
    /*TODO tell all clients that we be closing
	let chain = Promise.resolve();
	for(let gid of gidList.openGames) chain = chain.then(() => {
		return sessManager.getSess(gid).then(sess => sess.emit(enums.ended));
	});
	*/
}

process.stdin.resume();
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(0));
process.on('SIGUSR1', () => process.exit(0));
process.on('SIGUSR2', () => process.exit(0));
process.on('uncaughtException', (e) => {
	console.log(JSON.stringify(e.stack));
	process.exit(0);
});

startServer();