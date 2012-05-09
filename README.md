# ws-multi-proxy
## Many to many WebSocket proxy server

There are some WebSocket servers that only support a single connected client at a time.  
You may want to connect multiple clients to that same server.  
This lets you do that.

## Usage

1. Setup a proxy server `var proxy = new WebSocketProxy({ debug:true, webSocketServer:{ port:1234 } })`
3. Open `http://www.websocket.org/echo.html` in your browser
4. Try it out using `ws://localhost:1234/proxy/ws://echo.websocket.org`


## Advanced Usage: Connect multiple devtool frontends simultaneously

```shell
# install the proxy server
npm install ws-multi-proxy

# launch the basic proxy server
node ./node_modules/ws-multi-proxy/index.js 9023 &

# launch a browser with remote webkit inspector server enabled
open -a "Google Chrome Canary" --args --remote-debugging-port=9222 --user-data-dir="$TMPDIR/.chrome-user-data" about:blank

# find the first available debugger socket
DEBUGGER_SOCKET=$(curl -s "http://localhost:9222/json"|grep webSocketDebuggerUrl|cut -d'"' -f4| head -1)

# inspector client 1
open -a "Google Chrome Canary" "http://trac.webkit.org/export/116497/trunk/Source/WebCore/inspector/front-end/inspector.html?ws=localhost:9023/proxy/$DEBUGGER_SOCKET"

# inspector client 2
open -a "Google Chrome Canary" "http://trac.webkit.org/export/116497/trunk/Source/WebCore/inspector/front-end/inspector.html?ws=localhost:9023/proxy/$DEBUGGER_SOCKET"

# etc...
```

Yay, multiple clients connected to the same inspector session at once.


## Advanced Usage

ws-multi-proxy is pretty simple wrapper around the `ws` module's `WebSocketServer`.

WebSocket connections are just http GET requests sent with some special headers. So, in order to accept WebSocket connections, we need an http server. The `WebSocketServer` can create one for you or use an existing http server instance if you have one.

### Create a new http server
Or using an existing server instance you have lying around

    var httpServer = require('http').createServer().listen(1234)

### Create a `WebSocketServer` config
Tell it which server to use

    var wssConfig = { server:httpServer }

### Create a `WebSocketProxy`
Tell it which WebSocketServer config to use

    var proxy = new WebSocketProxy({ webSocketServer:wssConfig })

### Customize the routing logic
By default the `mutateDataFrom*` methods handle multiple clients by namespacing the message id. You can modify this logic to do whatever you want.

    proxy.mutateDataFromServer =
    proxy.mutateDataFromClient = function(data, sender, receiver){
      
      // perform some sort of custom message validation
      if (data.myCustomToken != receiver.myCustomToken)
        return false // don't sent message
      
      // or maybe augment the message before it is received
      data.value += " lol, augmented value"
      
      return data
    }

Or keep the existing functionality by monkeypatching.

    var oldMutateDataFromClient = proxy.mutateDataFromClient
    proxy.mutateDataFromClient = function(data, sender, receiver){
      
      // some sort of custom message validation
      if (data.myCustomToken != receiver.myCustomToken)
        return false // don't sent message
      
      return oldMutateDataFromClient.call(this, data, sender, receiver)
    }
