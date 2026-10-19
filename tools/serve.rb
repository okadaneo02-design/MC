#!/usr/bin/env ruby
# Static server + WebSocket relay for MACHINECRAFT.
#
# This machine has no Node.js, so there is no build step and no socket library to
# install — the game is plain ES modules with an import map, served by WEBrick
# (ships with Ruby). Multiplayer is "all web based": the SAME server also runs a
# tiny hand-rolled WebSocket relay (RFC6455, stdlib only) on port+1 that forwards
# messages between the two players in a room. No gems, no Node, no external hosts.
#
#   ruby tools/serve.rb [port]
#   game:  http://<this-machine-ip>:<port>/
#   relay: ws://<this-machine-ip>:<port+1>/?room=NAME   (used automatically)

require 'webrick'
require 'socket'
require 'digest/sha1'
require 'base64'
require 'thread'

port = (ARGV[0] || 5173).to_i
root = File.expand_path('..', __dir__)

# ---------------------------------------------------------------------------
# WebSocket relay (RFC6455, text frames) — rooms of up to a few peers.
# ---------------------------------------------------------------------------
WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
ROOMS = Hash.new { |h, k| h[k] = [] }
ROOMS_MUTEX = Mutex.new

def ws_handshake(sock, key)
  accept = Base64.strict_encode64(Digest::SHA1.digest(key + WS_MAGIC))
  sock.write("HTTP/1.1 101 Switching Protocols\r\n" \
             "Upgrade: websocket\r\nConnection: Upgrade\r\n" \
             "Sec-WebSocket-Accept: #{accept}\r\n\r\n")
end

# Read one frame -> [opcode, payload_string] or nil on close/error.
def ws_read(sock)
  h = sock.read(2)
  return nil unless h && h.bytesize == 2
  b1, b2 = h.bytes
  opcode = b1 & 0x0f
  masked = (b2 & 0x80) != 0
  len = b2 & 0x7f
  if len == 126
    len = sock.read(2).unpack1('n')
  elsif len == 127
    len = sock.read(8).unpack1('Q>')
  end
  mask = masked ? sock.read(4).bytes : nil
  payload = len > 0 ? sock.read(len) : ''.b
  return nil if payload.nil?
  if mask
    pb = payload.bytes
    pb.each_index { |i| pb[i] ^= mask[i % 4] }
    payload = pb.pack('C*')
  end
  [opcode, payload]
end

def ws_write(sock, data, opcode = 1)
  bytes = data.b
  n = bytes.bytesize
  header = [0x80 | opcode]
  if n < 126
    header << n
  elsif n < 65_536
    header << 126
    header.concat([n].pack('n').bytes)
  else
    header << 127
    header.concat([n].pack('Q>').bytes)
  end
  sock.write(header.pack('C*') + bytes)
end

def ws_relay_server(port)
  srv = TCPServer.new('0.0.0.0', port)
  loop do
    client = srv.accept
    Thread.new(client) do |sock|
      room = nil
      begin
        # read the HTTP upgrade request
        req = +''
        while (line = sock.gets)
          req << line
          break if line == "\r\n"
        end
        key = req[/Sec-WebSocket-Key:\s*(\S+)/i, 1]
        path = req[/GET\s+(\S+)\s+HTTP/i, 1] || '/'
        room = (path[/room=([^&\s]+)/, 1] || 'default')
        next unless key
        ws_handshake(sock, key)
        ROOMS_MUTEX.synchronize { ROOMS[room] << sock }
        # let both peers know how many are present
        announce = proc do
          n = ROOMS_MUTEX.synchronize { ROOMS[room].size }
          ROOMS_MUTEX.synchronize { ROOMS[room].dup }.each do |s|
            begin; ws_write(s, %({"t":"__peers","n":#{n}})); rescue; end
          end
        end
        announce.call
        loop do
          frame = ws_read(sock)
          break if frame.nil?
          op, payload = frame
          break if op == 8          # close
          next if op == 9 || op == 10 # ping/pong — ignore
          next unless op == 1       # text only
          peers = ROOMS_MUTEX.synchronize { ROOMS[room].reject { |s| s.equal?(sock) }.dup }
          peers.each { |p| begin; ws_write(p, payload); rescue; end }
        end
      rescue => e
        # swallow — one dead peer shouldn't take down the relay
      ensure
        if room
          ROOMS_MUTEX.synchronize { ROOMS[room].delete(sock) }
          begin
            left = ROOMS_MUTEX.synchronize { ROOMS[room].dup }
            left.each { |s| begin; ws_write(s, %({"t":"__peers","n":#{left.size}})); rescue; end }
          rescue; end
        end
        sock.close rescue nil
      end
    end
  end
rescue => e
  warn "[relay] failed: #{e}"
end

ws_port = port + 1
Thread.new { ws_relay_server(ws_port) }

# ---------------------------------------------------------------------------
# Static file server (WEBrick)
# ---------------------------------------------------------------------------
MIME = {
  '.js' => 'text/javascript; charset=utf-8', '.mjs' => 'text/javascript; charset=utf-8',
  '.css' => 'text/css; charset=utf-8', '.html' => 'text/html; charset=utf-8',
  '.json' => 'application/json; charset=utf-8', '.wasm' => 'application/wasm',
  '.svg' => 'image/svg+xml', '.png' => 'image/png', '.ico' => 'image/x-icon',
  '.jpg' => 'image/jpeg', '.jpeg' => 'image/jpeg',
}.freeze

mime_table = WEBrick::HTTPUtils::DefaultMimeTypes.dup
MIME.each { |ext, type| mime_table[ext.delete('.')] = type }

server = WEBrick::HTTPServer.new(
  BindAddress: '0.0.0.0',
  Port: port,
  DocumentRoot: root,
  MimeTypes: mime_table,
  AccessLog: [],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN),
)
server.config[:RequestCallback] = proc { |_req, res| res['Cache-Control'] = 'no-store' }

trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }

lan = Socket.ip_address_list.detect { |a| a.ipv4? && a.ipv4_private? }&.ip_address
puts "MACHINECRAFT serving #{root}"
puts "  http://localhost:#{port}/          game (this machine)"
puts "  http://#{lan}:#{port}/   share this with players on the same WiFi" if lan
puts "  ws relay on port #{ws_port}"
server.start
