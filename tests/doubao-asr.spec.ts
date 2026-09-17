import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { buildFrame, parseFrame } from '../src/main/asr/doubao-asr'

describe('豆包 ASR 帧编解码', () => {
  it('构造带正序号的客户端音频帧', () => {
    const payload = Buffer.from('audio')
    const frame = buildFrame(0x2, 0x1, 0, 1, payload, 7)

    expect(frame[0]).toBe(0x11)
    expect(frame[1]).toBe(0x21)
    expect(frame[2]).toBe(0x01)
    expect(frame.readInt32BE(4)).toBe(7)
    expect(frame.readUInt32BE(8)).toBe(payload.length)
    expect(frame.subarray(12)).toEqual(payload)
  })

  it('解析 gzip 压缩的最后一个服务端响应包', () => {
    const body = {
      result: {
        text: '累计文本',
        utterances: [{ text: '最后一个问题', definite: true }],
      },
    }
    const frame = buildFrame(
      0x9,
      0x2,
      1,
      1,
      gzipSync(Buffer.from(JSON.stringify(body))),
    )

    const parsed = parseFrame(frame)

    expect(parsed.type).toBe(0x9)
    expect(parsed.isLastPackage).toBe(true)
    expect(parsed.body).toEqual(body)
  })

  it('解析服务端错误码', () => {
    const message = gzipSync(Buffer.from(JSON.stringify({ message: '凭证错误' })))
    const header = Buffer.alloc(12)
    header[0] = 0x11
    header[1] = 0xf0
    header[2] = 0x11
    header.writeUInt32BE(45_000_001, 4)
    header.writeUInt32BE(message.length, 8)

    const parsed = parseFrame(Buffer.concat([header, message]))

    expect(parsed.errorCode).toBe(45_000_001)
    expect(parsed.body?.message).toBe('凭证错误')
  })
})
