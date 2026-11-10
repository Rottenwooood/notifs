import { MessagingError } from '@notify-hub/contracts';

const MAX_FRAME = 1_048_576;
export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > MAX_FRAME) throw new MessagingError('frame_too_large', 'IPC 消息帧超限', 413);
  const header = Buffer.allocUnsafe(4); header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
/** Stateful decoder handles partial headers, partial bodies and multiple frames without repeated concatenation. */
export class FrameDecoder {
  private header = Buffer.alloc(4);
  private headerBytes = 0;
  private body?: Buffer;
  private bodyBytes = 0;
  push(chunk: Buffer, consume: (value: unknown) => void): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.body) {
        const n = Math.min(4 - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + n);
        this.headerBytes += n; offset += n;
        if (this.headerBytes < 4) continue;
        const length = this.header.readUInt32BE();
        if (!length || length > MAX_FRAME) throw new MessagingError('invalid_frame', '非法 IPC 帧长度');
        this.body = Buffer.allocUnsafe(length); this.bodyBytes = 0; this.headerBytes = 0;
      }
      const n = Math.min(this.body.length - this.bodyBytes, chunk.length - offset);
      chunk.copy(this.body, this.bodyBytes, offset, offset + n);
      this.bodyBytes += n; offset += n;
      if (this.bodyBytes === this.body.length) {
        const body = this.body; this.body = undefined;
        consume(JSON.parse(body.toString('utf8')));
      }
    }
  }
}
