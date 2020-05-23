const strats = require("./heuristics");
const gameState = require("./gameState"); 

//TODO FAR FUTURE: Agents that take into account game history.

exports.agentConfig = {};
exports.agentConfig.minMax = {
	depth:2,
	dim: 0.90, //The loss in rewards the farther in the future it is.
	overlook:0 //Fraction of possible moves to randomly overlook
	//Must simplify scenarios where grid becomes fully unlocked
};

function reflexEval(state,move,stratList){
	return new Promise((callback) => {
		let score = 0;
		let promises = [];
		stratList.forEach((strat) => {
			let dupe = JSON.parse(JSON.stringify(state));
			promises.push(strat(dupe,move).then((points) => {score += points;}));
		});
		Promise.all(promises).then(() => {callback(score)});
	});
}

function getActions(state){
	let possible = [];
	if(state.winner != -1) return possible;
	if(state.curLock == -1){
		for(let i = 1; i <= state.conf.size; i++){
			if(state.grid[i].winner != -1) continue;
			for(let n = 1; n <= state.conf.size; n++){
				if(state.grid[i][n].winner == -1) possible.push([i,n]);
			}
		}
	}else for(let c = 1; c <= state.conf.size; c++){
		if(state.grid[state.curLock][c].winner == -1) possible.push([state.curLock,c]);
	}
	return possible;
}

function reflexStateEval(state,stratList,poss){
	let possible = (poss==null)?getActions(state):poss;
	if(possible.length == 0) return Promise.resolve(strats.draw);
	
	return new Promise((callback,reject) => {
		let score = -strats.win;
		let best = possible[Math.floor(Math.random()*(possible.length))];
		let promises = [];
		possible.forEach((move) => {
			promises.push(reflexEval(state,move,stratList).then((points) => {
				if(points > score){
					score = points;
					best = move;
				}
			}));
		});
		Promise.all(promises).then(() => {
			callback([best,score]);
		});
	});
}

exports.minMax = function(state,stratList,bot_ind,depth){
	stratList = (stratList == null)? [strats.winHeuristic]: stratList;
	depth = (depth == null)? 0: depth;
	
	if(depth >= exports.agentConfig.minMax.depth) return reflexStateEval(state,stratList);
	
	if(state.plyr == bot_ind) depth += 1;
	let threshold = exports.agentConfig.minMax.dim;
	let possible = getActions(state);
	let score = -strats.win;
	let best = possible[Math.floor(Math.random()*(possible.length))];
	let chain = Promise.resolve();
	
	for(let move of possible){
		chain = chain.then(() => {
			return reflexEval(state,move,stratList).then((points) => {
				if(points >= score*threshold){ //filter time based filter.
					let dupe = JSON.parse(JSON.stringify(state));
					let prevP = dupe.plyr;
					return gameState.place(dupe,move).then(() => {
						if(dupe.winner == prevP){
							return Promise.resolve().then(() => {
								points += strats.win*threshold;
								if(points > score){
									score = points;
									best = move;
								}
							});
						}else return exports.minMax(dupe,stratList,bot_ind,depth).then((suggestion) => {
							points -= suggestion[1]*threshold;
							if(points > score){
								score = points;
								best = move;
							}
						});
					}).then(() => {
						return new Promise((callback) => {setTimeout(callback,0)});
					});
				}
			});
		});
	}
	return chain.then(() => {return [best,score]});
};


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








