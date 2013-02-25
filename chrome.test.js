#!/usr/bin/env node
/*jshint asi:true*/

if (module.id == '.') process.nextTick(function(){
  exports.testChrome(require('./index').WebSocketProxy)
})

var WebSocket = require('ws')


// Instead of a real test, here is a demo of a remote web inspector multiplexing proxy, w00t
exports.testChrome = function(WebSocketProxy){
  var config = {
    proxyServer: {
      "url": "ws://localhost:8888/proxy",
      "port": 8888
    },
    devtoolsPort: 9222
  }
  
  var proxyServer = require('http').createServer()
  proxyServer.listen(config.proxyServer.port)
  var proxy = new WebSocketProxy({ debug:true, webSocketServer:{ server:proxyServer } })
  console.log("WebSocketProxy connected on '%s'", config.proxyServer.url)
  
  clientFromEachWebSocketServer(config, function onClientOpen(error, client){
    
    if (error) throw Error(error)
    // console.log('clientFromEachWebSocketServer callback', client)
    console.log('mock client open')
    client.on('message', function(message){
      console.log('mock client got message', message)
      var data = JSON.parse(message)
      client.emit('message::' + data.id, data)
    })
    var messageID = 0
    function sendMessage(method, params, callback){
      ++ messageID
      client.once('message::' + messageID, function(data){
        callback(data.error, data.result, data)
      })
      var message = JSON.stringify({ "id":messageID, "method":method, "params":params })
      console.log("client sending message: '%s'", message)
      client.send(message)
    }
    function Runtime_evaluate(expression, originalCallback){
      function callback(error, result, data){
        console.log("Runtime.evaluate '%s' → ", expression, result)
        originalCallback(error, result, data)
      }
      ++ messageID
      sendMessage("Runtime.evaluate", {"expression":expression, "returnByValue":true}, function(error, result, data){
        if (error) return callback(error, result)
        if (result.wasThrown) return callback(result.result)
        callback(null, result.result)
      })
    }
    
    sendMessage("Debugger.canSetScriptSource", null, function(error, result){
      console.assert(result.result, "Debugger.canSetScriptSource")
    })
    
    Runtime_evaluate("6 * 7", function(error, result){
      if (error) console.error(error)
      console.assert(result.value === 6 * 7)
    })
    Runtime_evaluate("location", function(error, result){})
    Runtime_evaluate("document.body.innerHTML = 'Hello from node-ws-multi-proxy!'", function(error, result){})
    
  })
}

function clientFromEachWebSocketServer(config, callback){
  var chrome = launchChrome({
    "bin":"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "args":[ // http://peter.sh/experiments/chromium-command-line-switches/
      "--app",
      "--remote-debugging-port=" + config.devtoolsPort,
      "--user-data-dir="+ process.env.TMPDIR +"/chrome-user-data",
      "about:blank"
    ],
    "jsonUrl": "http://localhost:"+ config.devtoolsPort +"/json"
  })
  chrome.on('availableConnection', function(item){
    // console.log(item)
    // simply prepend 'ws://localhost:1234/' to a regular websocket url to proxify it
    item.webSocketDebuggerUrl = item.webSocketDebuggerUrl.replace('///', '//localhost:'+ config.devtoolsPort +'/')
    var url = config.proxyServer.url + '/' + item.webSocketDebuggerUrl
    console.log(url)
    var client = new WebSocket(url)
    client.on('error', function(error){callback(error)})
    client.on('open', function(){callback(null, client)})
  })
}

function launchChrome(config){
  var chrome = require('child_process').execFile(config.bin, config.args)
  chrome.stdout.data = ''; chrome.stdout.on('data', function(data){this.data += data})
  chrome.stderr.data = ''; chrome.stderr.on('data', function(data){this.data += data})
  chrome.on('exit', function(exitCode){
    console.warn('chrome exit', config, exitCode, chrome.stdout.data, chrome.stderr.data)
  })
  setTimeout(function(){
    require('request').get(config.jsonUrl, function(err, response, data){
      if (err) return console.error(config.jsonUrl, err)
      chrome.emit('availableConnections', JSON.parse(data))
    })
  }, 250)
  chrome.on('availableConnections', function(availableConnections){
    availableConnections.forEach(chrome.emit.bind(chrome, 'availableConnection'))
  })
  chrome.on('exit', process.exit.bind(process, 0))
  process.on('exit', chrome.kill.bind(chrome))
  process.on('uncaughtException', function(error){
    console.error(error.stack)
    chrome.kill()
    process.exit()
  })
  return chrome
}
