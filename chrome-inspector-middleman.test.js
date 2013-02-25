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
    console.log('clientFromEachWebSocketServer callback', client.url)
    
    var inspectorUI = launchChrome({
      "bin":"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "args":[ // http://peter.sh/experiments/chromium-command-line-switches/
        "--app",
        "--remote-debugging-port=" + config.devtoolsPort+1,
        "--user-data-dir="+ process.env.TMPDIR +"/chrome-user-data-ui",
        'http://localhost:' + config.devtoolsPort + '/devtools/devtools.html?ws=' + client.url.replace('ws://','')
      ],
      "jsonUrl": "http://localhost:"+ config.devtoolsPort+1 +"/json"
    })
    inspectorUI.on('availableConnections', function(){
      console.log('UI started')
    })
    
    var traverse = require('traverse')
    
    proxy._old_mutateDataFromServer = proxy.mutateDataFromServer
    proxy.mutateDataFromServer = function(data, server, client){
      console.log('mutateDataFromServer', data)
      
      traverse(data).forEach(function(){
        if (this.key == 'nodeName') this.update('LULZ')
      })
      
      return this._old_mutateDataFromServer(data, server, client)
    }
  })
}

function clientFromEachWebSocketServer(config, callback){
  var chrome = launchChrome({
    "bin":"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "args":[ // http://peter.sh/experiments/chromium-command-line-switches/
      "--app",
      "--remote-debugging-port=" + config.devtoolsPort,
      "--user-data-dir="+ process.env.TMPDIR +"/chrome-user-data",
      'file://' + __dirname + '/chrome-inspector-middleman.test.html'
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
