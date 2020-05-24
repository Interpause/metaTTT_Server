const strats = require("./heuristics");
const gameState = require("../common/classes/gameState"); 

function copy(o) {
	var out, v, key;
	out = Array.isArray(o) ? [] : {};
	for (key in o) {
		v = o[key];
		out[key] = (typeof v === "object" && v !== null) ? copy(v) : v;
	}
	return out;
 }

function getRandom(arr, n) {
	n = Math.min(arr.length,n);
    var result = new Array(n),
        len = arr.length,
        taken = new Array(len);
    while (n--) {
        var x = Math.floor(Math.random() * len);
        result[n] = arr[x in taken ? taken[x] : x];
        taken[x] = --len in taken ? taken[len] : len;
    }
    return result;
}

//TODO FAR FUTURE: Agents that take into account game history.

module.exports.agentConfig = {};
module.exports.agentConfig.minMax = {
	depth:2,
	dim: 0.80, //The loss in rewards the farther in the future it is.
	full_overlook:Math.floor(1*81),	//Number of random moves to consider during full unlock
	norm_overlook:Math.floor(1*9)		//Number of random mvoes to consider during normal unlock
	//Must simplify scenarios where grid becomes fully unlocked
};

async function reflexEval(state,move,stratList){
	let score = 0;
	let endstate = new gameState(copy(state),true);
	endstate.place(move);
	for(let strat of stratList) score += await strat(move,endstate);
	return [score,endstate];
}

function getActions(state){
	if(state.winner != null) return [];
	let possible = [];
	if(state.cur_board == null){
		for(let i = 1; i <= state.config.size; i++){
			if(state.grid[i].winner != null) continue;
			for(let n = 1; n <= state.config.size; n++){
				if(state.grid[i][n].winner == null) possible.push([i,n]);
			}
		}
	}else for(let c = 1; c <= state.config.size; c++){
		if(state.grid[state.cur_board][c].winner == null) possible.push([state.cur_board,c]);
	}
	return possible;
}

async function reflexStateEval(state,stratList,possible){
	if(possible.length == 0) return strats.draw;

	let score = -2*strats.win;
	let best = possible[0];
	for(let move of possible){
		let sug = await reflexEval(state,move,stratList);
		if(sug[0] > score){
			score = sug[0];
			best = move;
		}
	}
	return [best,score];
}

module.exports.minMax = async function(state,stratList,bot_ind,depth){
	stratList = (stratList == null)? [strats.winHeuristic]: stratList;
	depth = (depth == null)? 0: depth;

	let possible = getActions(state);
	if(state.cur_board == null) possible = getRandom(possible,module.exports.agentConfig.minMax.full_overlook);
	possible = getRandom(possible,module.exports.agentConfig.minMax.norm_overlook);
	
	if(depth >= module.exports.agentConfig.minMax.depth) return reflexStateEval(state,stratList,possible);
	if(state.cur_player_ind == bot_ind) depth += 1;

	let threshold = module.exports.agentConfig.minMax.dim;
	let score = -2*strats.win;
	let best = possible[0];
	
	for(let move of possible){
		let sug = await reflexEval(state,move,stratList);
		let points = sug[0];
		let endstate = sug[1];
		if(points >= score*threshold){ //time based filter.
			if(endstate.winner == state.cur_player_ind) points += strats.win*threshold;
			else{
				let suggestion = await module.exports.minMax(endstate,stratList,bot_ind,depth);
				points -= suggestion[1]*threshold;
			}
			if(points > score){
				score = points;
				best = move;
			}
		}
		await new Promise(res => setTimeout(res,0));
	}
	return [best,score];
};

module.exports.abMinMax = async function(state,stratList,bot_ind,depth,a,b){
	stratList = (stratList == null)? [strats.winHeuristic]: stratList;
	depth = (depth == null)? 0: depth;

	let possible = getActions(state);
	if(possible.length == 0){
		if(state.winner == bot_ind) return [null,strats.win];
		else if(state.winner == -1) return [null,strats.draw];
		else return [null,strats.loss]; //originally negative alr
	}
	if(depth >= 4){
		if(state.cur_player_ind == bot_ind) return reflexStateEval(state,stratList,possible);
		else return -1*reflexStateEval(state,stratList,possible);
	}

	if(state.cur_player_ind == bot_ind){
		let score = -2*strats.win;
		let best = possible[0];
	
		for(let move of possible){
			let endstate = new gameState(copy(state),true);
			endstate.place(move);
			let sug = await module.exports.abMinMax(endstate,stratList,bot_ind,depth+1,a,b);
			let points = sug[1];
			if(points >= score){
				score = points;
				best = move;
			}
			a = Math.max(a,score);
			if(a >= b) break;
		}
		return [best,score];
	}else{
		let score = 2*strats.win;
		let best = possible[0];

		for(let move of possible){
			let endstate = new gameState(copy(state),true);
			endstate.place(move);
			let sug = await module.exports.abMinMax(endstate,stratList,bot_ind,depth+1,a,b);
			let points = sug[1];
			if(points <= score){
				score = points;
				best = move;
			}
			b = Math.min(b,score);
			if(a >= b) break;
		}
		return [best,score];
	}
}