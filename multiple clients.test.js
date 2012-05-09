#!/usr/bin/env node
/*jshint asi:true*/

if (module.id == '.') process.nextTick(function(){
  var testNames = Object.keys(exports)
  var index = -1
  function next(){
    ++ index
    var test = exports[testNames[index]]
    if (!test) return
    console.warn(testNames[index])
    test(next)
  }
  next()
})

var WebSocketProxy = require('./index').WebSocketProxy
var WebSocket = require('ws')
var assert = require('assert')

exports['proxy should exist'] = function(next){
  assert.ok(WebSocketProxy)
  assert.equal(typeof WebSocketProxy, 'function')
  next()
}

exports['proxy should route responses to the correct client'] = function(next){
  var next = setupTestServerAndProxy(next).next
  
  var client1 = new WebSocket('ws://localhost:9023/proxy/ws://localhost:9022')
  client1.once('open', function(){
    
    client1.once('message', function(message){
      var data = JSON.parse(message)
      assert.equal(data.value, "foo")
      
      var client2 = new WebSocket('ws://localhost:9023/proxy/ws://localhost:9022')
      client2.once('open', function(){
        client1.once('message', function(message){throw Error('should not have received message')})
        client2.once('message', function(message){
          var data = JSON.parse(message)
          assert.equal(data.value, "bar")
          process.nextTick(next)
        })
        client2.send('{"id":1, "value":"bar"}')
      })
    })
    client1.send('{"id":1, "value":"foo"}')
  })
}

exports['proxy should connect multiple clients to a single '] = function(next){
  var next = setupTestServerAndProxy(next).next
  var client1 = new WebSocket('ws://localhost:9023/proxy/ws://localhost:9022')
  client1.once('open', function(){
    var client2 = new WebSocket('ws://localhost:9023/proxy/ws://localhost:9022')
    client2.once('open', function(){
      process.nextTick(next)
    })
  })
}

function setupTestServerAndProxy(next){
  var test = {}
  test.server = new WebSocket.Server({ port:9022 })
  test.proxy = new WebSocketProxy({ debug:true, webSocketServer:{ port:9023 } })
  
  // Echo server
  test.server.once('connection', function(connection){
    test.server.once('connection', function(connection){throw Error('test server only accepts a single connection')})
    connection.on('message', function(message){
      connection.send(message)
    })
  })
  
  test.next = function(){
    test.server.close()
    test.proxy.webSocketServer.close()
    next()
  }
  return test
}


