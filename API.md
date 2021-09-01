# Websocket API

- [Overview](#overview)
- [Connecting to the server](#connecting-to-the-server)
- [Getting info about game sessions](#getting-info-about-game-sessions)
- [Finding an open game session](#finding-an-open-game-session)
- [Making a game move](#making-a-game-move)
- [Receiving a game state update](#receiving-a-game-state-update)
- [Forfeiting a game session](#forfeiting-a-game-session)
- [Creating a game session](#creating-a-game-session)
- [Disconnecting from the server](#disconnecting-from-the-server)

## Overview

In general, messages sent by the client and server over websocket take the form of:

```ts
{ event: string, data: any }
```

Where `event` is one of the enum values found in `./common/utils/enums.js`:

```ts
const enums = {
  //Specific
  locked: "BOARD LOCKED",
  occupied: "SQUARE FULL",
  started: "GAME STARTED",
  ended: "GAME ENDED",
  full: "GAME FULL",
  move: "MOVE",
  turn: "TURN",
  unfound: "NOT FOUND LOL",
  //General
  okay: "OKAY",
  error: "FAIL",
  null: "NullPointerException",
  info: "INFO",
  busy: "BUSY",
  //Server<-->Client events
  getSessions: "GET SESSIONS",
  getSpecSessions: "GET SPEC SESSIONS",
  createSession: "MAKE ME A GAME",
  findSession: "FIND ME A GAME",
  updateState: "STATE UPDATE",
  join: "JOIN",
  leave: "LEAVE",
  disconnect: "DISCONNECTING",
  connect: "HELLO",
}
```

Normally the message sent by the server or client in response to an `event` will use the same `event`. The value of `data` depends on the `event` as will be listed in the following cases. Multiple messages can be sent by the client or server at the same time by sending a array of them instead. As the server actually buffers unsent messages if the client were to disconnect, the client should be capable of handling an array of such messages.

## Connecting to the server

When the client establishes a websocket connection with the server, the server will send:

```ts
{ event: enums.connect }
```

The client is then expected to reply with:

```ts
{
  event: enums.connect,
  data: {
    name: string,
    pid: string,
    passwd: string
  }
}
```

`pid` stands for player id. If that id is not already registered, the server will create a new player profile using that `pid` and `passwd`. If the `pid` is already registered, it will check if the `passwd` sent matches the one in the database, allowing the client to remain connected only if the password matches. `name` is the name of the player profile and can easily be changed as the `name` that is sent by the client always overwrites the one on the server. As the authentication is tied to the websocket, the client will stay authenticated and does not need to resend the credentials until disconnection.

Finally, on successful authentication, the server replies with:

```ts
{ event: enums.okay }
// if not successful, no reply is sent as the client is disconnected.
```

In the current [client implementation](https://github.com/Interpause/metaTTT_App), `pid` and `passwd` are randomly generated UUIDs when the app first starts up. While this means player profiles are not fully featured, it also means many of the safety concerns that normally have to be handled are bypassed.

## Getting info about game sessions

The client can send this:

```ts
{ event: enums.getSessions | enums.getSpecSessions }
```

Upon which the server replies with:

```ts
{
  event:enums.getSessions | enums.getSpecSessions
  data:{
    [gid:string]:{     // the keys are game ids
      cur:number,      // index of current turn's player id in names
      gconf:any,       // see https://interpause.github.io/metaTTT_Common/modules.html#defaultconfig
      maxPlys:number,  // max number of players
      names:string[],  // names of players
      numPlys:number,  // number of players
      plyrs:string[],  // pids of players
      specs:string[],  // pids of spectators + players
      started:boolean, // whether the game has started
      turn:number      // the current turn
    }
  }
}
```

This info can be used by the client to render a list of game sessions the player is already in or can spectate.

## Finding an open game session

The client can send this:

```js
{ event:enums.findSession }
```

Upon which the server replies with the `gid` (game id) of a open game session as `data`:

```js
{ event:enums.findSession, data:string }
```

Currently, if there are no open game sessions, the server will simply create a game session. If no one joins the game session after a while, the game AI will join the game instead.

## Joining a game session

The client sends this:

```js
{
  event:enums.join,
  data:{
    gid:string
  }
}
```

If successful, the server replies with:

```js
{ event:enums.join, data:enums.okay }
```

(Not implemented) else the server would send back the error as `data`, which can be `enums.started`, `enums.unfound` or `enums.error`:

While theoretically there should be cases where joining a game session could fail (private game, game is full, etc), I had not implemented an error message to send back. As such, the successful message will be sent back on any attempt to join a game, but if that attempt actually failed, there would be no subsequent game state update sent by the server.

## Making a game move

When it is the client's turn, the client sends:

```js
{
  event:enums.move,
  data:{
    gid:string,
    move:[number,number]
  }
}
```

If successful, the server replies with:

```js
{ event:enums.move, data:enums.okay }
```

Else the server sends back the error as `data`, which can be `enums.locked`, `enums.occupied` or `enums.error`.

## Receiving a game state update

When there is an update to the game state, the server will send:

```js
{
  event:enums.updateState,
  data:State // see https://interpause.github.io/metaTTT_Common/classes/state.html
}
```

(Not implemented) if the client wanted to receive the current game state:

```js
{ event:enums.updateState }
```

Currently, the update is resent whenever the player joins the game, and since messages are buffered if the client is not connected, it is unlikely for the client to have an outdated game state.

## Forfeiting a game session

The client would send:

```js
{ event:enums.leave }
```

Upon which the server replies:

```js
{ event:enums.leave, data:enums.okay }
```

## Creating a game session

Theoretically, this would allow for custom games and private games, but it has not been implemented:

```js
{ event:enums.createSession }
```

## Disconnecting from the server

The client can just close the websocket or send:

```js
{ event:enums.disconnect }
```

(Not implemented) Theoretically the server should send the same message to the client whenever it wants to disconnect the client.
