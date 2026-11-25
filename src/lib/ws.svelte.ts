import type { RoomSnapshot, WsIncoming, WsOutgoing } from './types';

export class RoomSocket {
  snapshot = $state<RoomSnapshot | null>(null);
  connected = $state(false);
  error = $state('');

  private ws: WebSocket | null = null;
  private code = '';
  private clientId = '';
  private nickname = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedManually = false;

  connect(code: string, clientId: string, nickname: string) {
    this.disconnect();
    this.closedManually = false;
    this.code = code.toUpperCase();
    this.clientId = clientId;
    this.nickname = nickname;
    this.openSocket();
  }

  private openSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/api/salas/${this.code}/ws`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.error = '';
      this.send({
        type: 'join',
        clientId: this.clientId,
        name: this.nickname
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsIncoming;
        if (msg.type === 'snapshot') {
          this.snapshot = msg.payload;
        } else if (msg.type === 'error') {
          this.error = msg.message;
        }
      } catch {
        // Ignore malformed packets
      }
    };

    ws.onclose = () => {
      this.connected = false;
      if (!this.closedManually) {
        this.reconnectTimer = setTimeout(() => this.openSocket(), 2000);
      }
    };

    ws.onerror = () => {
      this.error = 'Reconectando con la sala...';
    };
  }

  send(msg: WsOutgoing) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect() {
    this.closedManually = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}
