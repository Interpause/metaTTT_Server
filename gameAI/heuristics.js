//TODO: Heuristics, many kinds
//All heuristics assume state passed in is a copy.

let eul = 2.718281828459; //euler's number. It's... natural.
module.exports.heuristicConfig = {}; //within heuristic
module.exports.win = eul**16; //Overall
module.exports.draw = 0;//-(eul**7); //Overall
module.exports.loss = -(eul**15); //Overall
module.exports.heuristicConfig.winH = {
	nowin:0,
	draw:0,
	win:eul**3,
	fwin:module.exports.win
};

//All values from moveEval zeroing... Might be a glitch with the heuristic, or not enough depth.
//Or. The original version was somehow such a hack it made a useless heuristic do something useful.
//After all, the gomoku AI was never minMax. It didnt alpha beta prune, use time punishments and added the current state to the score.

//The first most fundamental, yet short-sighted heuristic. Example of heuristic.
module.exports.winHeuristic = async function(move,endstate,hconf){
	let score = 0;
	hconf = (hconf==null)?module.exports.heuristicConfig.winH:hconf.winH;

	if(endstate.winner != null && endstate.winner != -1){
		score += hconf.fwin;
		return score;
	}

	let winner = endstate.grid[move[0]].winner;
	if(winner == null) score += hconf.nowin;
	else if(winner == -1) score += hconf.draw;
	else score += hconf.win;
	return score;
};