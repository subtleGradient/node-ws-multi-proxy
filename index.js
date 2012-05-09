#!/usr/bin/env node
/*jshint asi:true*/

if (module.id == '.') process.nextTick(function(){
  var port = process.argv[2] || 9023
  if (!+port) console.warn('Usage: %s "%s" PORT_NUMBER', process.argv[0], process.argv[1])
  var proxy = new WebSocketProxy({ debug:true, webSocketServer:{ port:port } })
  console.warn('WebSocketProxy server started on port '+port+'')
  console.log('ws://localhost:'+port+'/proxy/ws://echo.websocket.org')
})

////////////////////////////////////////////////////////////////////////////////

var url = require('url')
var WebSocket = require('ws')
var WebSocketServer = WebSocket.Server

exports.WebSocketProxy = WebSocketProxy
function WebSocketProxy(config){
  var proxy = this;
  if (!(proxy instanceof WebSocketProxy)) throw Error('you need to use `new`')
  proxy.config = config
  
  // defaults
  if (!config.path) config.path = '/proxy/'
  if (!config.debug) config.debug = false
  
  // monkey patch verifyClient if necessary
  // This allow us to get access to reject connections with badly formatted urls
  var oldVerifyClient = config.webSocketServer.verifyClient
  if (oldVerifyClient) config.webSocketServer.verifyClient = function(info){ return oldVerifyClient.call(this, info) && proxy._verifyClient(info) }
  else config.webSocketServer.verifyClient = proxy._verifyClient.bind(proxy)
  
  // Setup the WebSocketServer
  if (config.webSocketServer instanceof WebSocketServer) throw Error('config.webSocketServer must not be an instanceof WebSocketServer. It cannot be modified after instantiation and must be configured properly before instantiation')
  if (typeof config.webSocketServer.on != 'function') config.webSocketServer = new WebSocketServer(config.webSocketServer)
  config.webSocketServer.on('connection', proxy._handleClientConnection.bind(proxy))
  proxy.webSocketServer = config.webSocketServer
}

WebSocketProxy.prototype = {
  
  constructor: WebSocketProxy,
  
  getServerUrl: function(location){
    var serverUrl
    if (location.query && location.query.ws) serverUrl = url.parse(location.query.ws, true)
    if (!serverUrl) {
      serverUrl = url.parse(location.pathname.replace(this.config.path, ''), true)
    }
    return serverUrl
  },
  _verifyClient: function(info){
    var request = info.req
    request._targetWebSocketUrl = this.getServerUrl(url.parse(request.url, true))
    if (this.config.debug) console.log('client attempting to connect to proxy', request.url, request._targetWebSocketUrl)
    return !!request._targetWebSocketUrl
  },
  
  servers: {},
  _getServerByUrl: function(url, callback){
    var proxy = this;
    var href = url.href || url
    if (proxy.servers[href] && proxy.servers[href].readyState == WebSocket.OPEN) {
      callback(null, proxy.servers[href])
      return
    }
    if (this.config.debug) console.log('proxy connecting to target:', href)
    var server = proxy.servers[href] = proxy.servers[href] || new WebSocket(href)
    server.once('open', function(){callback(null, server)})
    server.once('error', function(err){close(); callback(err)})
    server.once('close', close)
    var connectedClientCount = 0
    var closeTimer
    server.on('client open', function(client){
      clearTimeout(closeTimer)
      ++ connectedClientCount
      server.once('close', function(){
        client.close()
      })
      client.once('close', function(){
        server.emit('client close', client)
      })
    })
    server.on('client close', function(client){
      -- connectedClientCount
      if (connectedClientCount <= 0) closeTimer = setTimeout(server.close.bind(server), 1000)
    })
    function close(){if (proxy.servers[href] === server) delete proxy.servers[href]}
  },
  _handleClientConnection: function(client){
    var proxy = this
    if (proxy.config.debug) console.log('client connected to proxy')
    var request = client.upgradeReq
    // proxy.config.debug && client.send('from proxy')
    
    var bufferedMessages = []
    function client_bufferMessage(message){
      bufferedMessages.push(message)
      if (proxy.config.debug) console.log("proxy received message from client '%s' before proxy connected to server", message)
    }
    client.on('message', client_bufferMessage)
    function client_flushMessages(server){
      client.removeListener('message', client_bufferMessage)
      var message
      while (message = bufferedMessages.shift())
        client.emit('message', message)
    }
    proxy._getServerByUrl(request._targetWebSocketUrl, function(err, server){
      if (err) return client.send(err)
      if (proxy.config.debug) console.log('proxy connected to server', request._targetWebSocketUrl.href)
      
      var onMessageFromServer = function(msg){proxy.onMessageFromServer(msg, server, client)}
      var onMessageFromClient = function(msg){proxy.onMessageFromClient(msg, client, server)}
      
      server.emit('client open', client)
      server.on('message', onMessageFromServer)
      server.once('close', function(){
        if (proxy.config.debug) console.log('server disconnected from proxy')
        server.removeListener('message', onMessageFromServer)
        client.close()
      })
      client.on('message', onMessageFromClient)
      client.once('close', function(){
        if (proxy.config.debug) console.log('client disconnected from proxy')
        client.removeListener('message', onMessageFromClient)
      })
      client_flushMessages()
    })
  },
  
  onMessageFromClient: function(message, sender, receiver){
    if (this.config.debug) console.log("proxy received message from client: '%s'", message)
    if (this.mutateMessageFromClient)
      message = this.mutateMessageFromClient(message, sender, receiver)
    if (this.config.debug) console.log("proxy mutated  message from client: '%s'", message)
    if (message === false) return
    if (receiver.readyState != WebSocket.OPEN) {
      if (this.config.debug) console.error('onMessageFromClient receiver.readyState', receiver.readyState)
      return
    }
    receiver.send(message)
  },
  onMessageFromServer: function(message, sender, receiver){
    if (this.config.debug) console.log("proxy received message from server: '%s'", message)
    if (this.mutateMessageFromServer)
      message = this.mutateMessageFromServer(message, sender, receiver)
    if (this.config.debug) console.log("proxy mutated  message from server: '%s'", message)
    if (message === false) return
    if (receiver.readyState != WebSocket.OPEN) {
      if (this.config.debug) console.error('onMessageFromServer receiver.readyState', receiver.readyState)
      return
    }
    receiver.send(message)
  },
  
  parseMessage: function(message){
    var data = message
    try {
      data = JSON.parse(data)
    } catch(e){if (this.config.debug) console.warn(e)}
    return data
  },
  stringifyData: JSON.stringify,
  
  mutateMessageFromClient: function(message, sender, receiver){
    if (!this.mutateDataFromClient) return message
    var data = this.parseMessage(message)
    data = this.mutateDataFromClient(data, sender, receiver)
    if (data === false) return false
    return this.stringifyData(data)
  },
  mutateMessageFromServer: function(message, sender, receiver){
    if (!this.mutateDataFromServer) return message
    var data = this.parseMessage(message)
    data = this.mutateDataFromServer(data, sender, receiver)
    if (data === false) return false
    return this.stringifyData(data)
  },
  
  _proxyId: 1e7,
  _clientUID: 0,
  mutateDataFromClient: function(data, client, server){
    if (!data.id) return data
    if (!client._proxyId) {
      ++ this._clientUID
      client._proxyId = {id:this._clientUID, min:this._clientUID * this._proxyId, max:(this._clientUID+1) * this._proxyId -1}
      if (this.config.debug) console.log(client._proxyId)
    }
    data.id += client._proxyId.min
    return data
  },
  mutateDataFromServer: function(data, server, client){
    if (!data.id) return data
    if (data.id < 0) if (this.config.debug) console.error('unexpected id', data)
    if (data.id < this._proxyId) return data
    if (!client._proxyId) return false // hasn't requested any messages, so obviously not this one
    if (data.id > client._proxyId.max || data.id < client._proxyId.min) return false
    data.id -= client._proxyId.min
    return data
  },
}
