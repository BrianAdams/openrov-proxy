var url = require('url');
var net = require('net');
var http = require('http');
var BinaryServer = require('binaryjs').BinaryServer;
var express = require('express');
var request = require('request');
var app = express();
var server = http.createServer(app);
var bs = BinaryServer({ port: 3011 });
var io = require('socket.io')(server);
var connectionNumber = 0;
http.globalAgent.maxSockets=20;

bs.on('connection', function (client) {
  console.log('Connection to client');
  // Incoming stream from browsers
  client.on('stream', function (stream, meta) {
    var requestData = JSON.parse(meta);
    var handle;
    if (requestData.version == 1) {
      handle = requestData.ssl ? handleSsl : handleHttp1;
    } else {
      handle = requestData.ssl ? handleSsl : handleHttp;
    }
    handle(requestData, stream);
  });
  //helps keep the stream open over unreliable internet as the clients
  //don't auto reconnect well yet.
  client.on('end', function () {
    clearInterval(client.heartbeat);
  });
  client.on('close', function () {
    clearInterval(client.heartbeat);
  });
  client.on('error', function (err) {
    console.log("binaryjs client error:");
    console.dir(err);
  })
  client.heartbeat = setInterval(function () {
    var stream = client.send('heartbeat');
    stream.end();
  }, 5000);

});

bs.on('error', function(error) {
  console.log("BinaryJS error: ");
  console.dir(error);
});

server.listen(3001, function () {
  console.log('HTTP and BinaryJS server started on port 3001');
});
function handleHttp1(requestData, stream) {
  console.log('Stream requested, url: ' + requestData.url);
  // we first make a HEAD request to get access to the headers before
  // streaming the rest of the url data.
  request.head(requestData.url, function (error, response, body) {
    if (error) {
      stream.write('HTTP/1.1 ' + 500 + ' ' + 'Proxy Service Error' + '\r\n');
      stream.end();
      console.log('There was an error: ');
      console.dir(error);
      return;
    }
    stream.write('HTTP/1.1 ' + response.statusCode + ' ' + response.statusMessage + '\r\n');
    for (var item in response.headers) {
      stream.write(item + ': ' + response.headers[item] + '\r\n');
    }
    stream.write('\r\n');
    // once we are sure all is good, we go ahead and request the file and pipe it to the requestor
    request(requestData.url, function (error, response, body) {
      console.log('Done');
      stream.end();
    }).pipe(stream);
  });
}
//Depricated  - for backwards compatibility with earlier clients. Remove
//after 2015-Oct.
function handleHttp(requestData, stream) {
  console.log('Stream requested, url: ' + requestData.url);
  // we first make a HEAD request to see if the file is there. If not, or there
  // is any other issue, we return the error to the requestor as a JSON object.
  request.head(requestData.url, function (error, response, body) {
    if (error || response !== undefined && response.statusCode >= 400) {
      var statusCode = 0;
      if (response) {
        statusCode = response.statusCode;
      }
      stream.write(JSON.stringify({
        error: error,
        statusCode: statusCode
      }));
      stream.end();
      console.log('There was an error: ' + error + '\nStatus Code: ' + statusCode);
    } else {
      // once we are sure all is good, we go ahead and request the file and pipe it to the requestor
      request(requestData.url, function (error, response, body) {
        console.log('Done');
        stream.end();
      }).pipe(stream);
    }
  });
}
function handleSsl(requestData, stream) {

  var conn_num = connectionNumber;
  connectionNumber++;
  console.log(conn_num+ ':Stream requested, url: ' + requestData.url);
  var requestUrl = requestData.url;
  var srvUrl = url.parse(requestUrl);
  var thestream = stream;
  //console.dir(stream);
  var d = new Date();
  var client = net.connect({
      port: srvUrl.port,
      host: srvUrl.hostname
    }, function () {
      var connectiondelay= (new Date() - d);
      console.log(conn_num + ":net Connection delay:" + connectiondelay);
      thestream.write('HTTP/1.1 200 Connection Established\r\n' + 'Proxy-agent: Node-Proxy\r\n' + '\r\n');
      thestream.pipe(client);
      client.pipe(thestream);
    });
  client.on('end', function () {
    thestream.end();
    console.log (conn_num+ ":done... " + requestData.url + ' ' + (new Date() - d) + 'ms');
  });
  client.on('close', function() {
    thestream.end();
    console.log (conn_num + ":close recieved " + requestData.url  + ' ' + (new Date() - d) + 'ms');
  })
  client.on('error', function(error){
    thestream.end();
    console.log(conn_num + ':SSL Net error:');
    console.dir(error);
  });
  thestream.on('close', function(){
    console.log(conn_num + ':BinaryJS stream hung up.');
    client.end();
  });
  thestream.on('end', function(){
    console.log(conn_num + ':BinaryJS stream hung up.');
    client.end();
  });
}
