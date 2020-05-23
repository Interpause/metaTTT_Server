const strats = require("./heuristics");
const gameState = require("../common/classes/gameState"); 

//TODO FAR FUTURE: Agents that take into account game history.

module.exports.agentConfig = {};
module.exports.agentConfig.minMax = {
	depth:2,
	dim: 0.90, //The loss in rewards the farther in the future it is.
	overlook:0 //Fraction of possible moves to randomly overlook
	//Must simplify scenarios where grid becomes fully unlocked
};

async function reflexEval(state,move,stratList){
	let score = 0;
	let promises = [];
	stratList.forEach(strat => {
		let dupe = new gameState(JSON.parse(JSON.stringify(state)),true);
		promises.push(strat(dupe,move).then(points => score += points));
	});
	await Promise.all(promises);
	return score;
}

function getActions(state){
	let possible = [];
	if(state.winner != null) return possible;
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

async function reflexStateEval(state,stratList,poss){
	let possible = (poss==null)?getActions(state):poss;
	if(possible.length == 0) return strats.draw;

	let score = -strats.win;
	let best = possible[Math.floor(Math.random()*(possible.length))];
	let promises = [];
	possible.forEach(move => {
		promises.push(reflexEval(state,move,stratList).then(points => {
			if(points > score){
				score = points;
				best = move;
			}
		}));
	});
	await Promise.all(promises);
	return [best,score];
}

module.exports.minMax = async function(state,stratList,bot_ind,depth){
	stratList = (stratList == null)? [strats.winHeuristic]: stratList;
	depth = (depth == null)? 0: depth;
	
	if(depth >= module.exports.agentConfig.minMax.depth) return reflexStateEval(state,stratList);
	
	if(state.cur_player_ind == bot_ind) depth += 1;
	let threshold = module.exports.agentConfig.minMax.dim;
	let possible = getActions(state);
	let score = -strats.win;
	let best = possible[Math.floor(Math.random()*(possible.length))];
	
	for(let move of possible){
		points = await reflexEval(state,move,stratList);
		if(points >= score*threshold){ //time based filter.
			let dupe = new gameState(JSON.parse(JSON.stringify(state)),true);
			let prevP = dupe.cur_player_ind;
			dupe.place(move);
			if(dupe.winner == prevP){
				points += strats.win*threshold;
				if(points > score){
					score = points;
					best = move;
				}
			}else{
				suggestion = await module.exports.minMax(dupe,stratList,bot_ind,depth);
				points -= suggestion[1]*threshold;
				if(points > score){
					score = points;
					best = move;
				}
			}
		}
		await new Promise(callback => setTimeout(callback,0)); //prevent lag due to AI
	}
	return [best,score];
};

/**
//TODO order optimization put grid unlocks end of queue in getActions.
function ABminMaxEval(state,stratList,bot_ind,depth,alpha,beta){	
	if(state.winner != -1){
		if(state.winner == null) return Promise.resolve(strats.draw);
		else return Promise.resolve(strats.win);
	}else if(depth == 0) return reflexStateEval(state,stratList);
	
	let score = (state.plyr==bot_ind)?-strats.win:strats.win;
	let promises = [];
	for(const move of getActions(state)){
		let dupe = JSON.parse(JSON.stringify(state));
		promises.push(gameState.place(dupe,move).then(() => {
			return miniMaxEval(dupe,stratList,bot_ind,depth-1,alpha,beta).then((value) => {
				if(state.plyr==bot_ind){
					score = Math.max(value,score);
					alpha = Math.max(alpha,score);
				}else{
					score = Math.min(value,score);
					beta = Math.min(beta,score);
				}
				if(alpha >= beta) return Promise.reject(new Error("BREAK"));
			});
		}));
	}
	return new Promise((callback,reject) => {	
		Promise.all(promises).then(() => {
			callback(score);
		}).catch((e) => {
			if(e.message != "BREAK") reject(e);
			callback(score);
		});
	});
}

exports.ABminMax = function(state,stratList,bot_ind,depth){
	stratList = (stratList == null)?[strats.winHeuristic]:stratList;
	bot_ind = (bot_ind==null)?state.plyr:bot_ind;
	maxDepth = (depth==null)?exports.agentConfig.minMax.depth:depth;
	
	let score = -strats.win;
	let possible = getActions(state);
	let best = possible[Math.floor(Math.random()*(possible.length))];
	let promises = [];
	for(const move of possible){
		promises.push(miniMaxEval(state,stratList,bot_ind,maxDepth,-strats.win,strats.win).then((points) => {
			if(points > score){
				best = move;
				score = points;
			}
		}));
	}
	return Promise.all(promises).then(() => {
			return [best,score];
	});
};




*/



