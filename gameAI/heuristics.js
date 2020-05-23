//TODO: Heuristics, many kinds
//All heuristics assume state passed in is a copy.
const gameState = require("./gameState"); 


let eul = 2.718281828459; //euler's number. It's... natural.
exports.heuristicConfig = {};
exports.win = eul**16;
exports.draw = -(eul**6);
exports.loss = -(eul**14);
exports.heuristicConfig.winH = {
	nowin:0,
	draw:0,
	win:eul**5,
	fwin:exports.win
};

//All values from moveEval zeroing... Might be a glitch with the heuristic, or not enough depth.
//Or. The original version was somehow such a hack it made a useless heuristic do something useful.
//After all, the gomoku AI was never minMax. It didnt alpha beta prune, use time punishments and added the current state to the score.

//The first most fundamental, yet short-sighted heuristic. Example of heuristic.
exports.winHeuristic = function(state,move,hconf){
	return new Promise((callback,reject) => {
		let score = 0;
		hconf = (hconf==null)?exports.heuristicConfig.winH:hconf.winH;
		
		gameState.place(state,move).then(() => {
			if(state.grid.winner != null && state.grid.winner != -1){
				score += hconf.fwin;
				callback(score);
				return;
			}
			let winner = state.grid[move[0]].winner;
			if(winner == -1) score += hconf.nowin;
			else if(winner == null) score += hconf.draw;
			else score += hconf.win;
			
			callback(score);
			return;
		}).catch((e) => {
			return;
			//reject(e);
			//console.log("Agent attempted to place in occupied/locked spot.");
			//callback(-(eul**6));
			//return;
		});
	});	
};