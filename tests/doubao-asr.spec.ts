import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { buildFrame, parseFrame } from '../src/main/asr/doubao-asr'

/**
 * 豆包协议是自定义二进制帧，头部按字节偏移拼装。偏移写错不会报错，
 * 只会让识别结果悄悄变空——读代码看不出，只能拿字节断言。
 */
describe('豆包 ASR 帧编解码', () => {
  it('构造客户端音频帧时头部偏移正确', () => {
    const payload = Buffer.from('audio')
    const frame = buildFrame(0x2, 0x1, 0, 1, payload, 7)

    expect([...frame.subarray(0, 4)]).toEqual([0x11, 0x21, 0x01, 0x00])
    expect(frame.readInt32BE(4)).toBe(7)
    expect(frame.readUInt32BE(8)).toBe(payload.length)
    expect(frame.subarray(12)).toEqual(payload)
  })

  it('解析 gzip 压缩的服务端响应，并认出最后一包', () => {
    const body = {
      result: { text: '累计文本', utterances: [{ text: '最后一个问题', definite: true }] },
    }
    const frame = buildFrame(0x9, 0x2, 1, 1, gzipSync(Buffer.from(JSON.stringify(body))))

    const parsed = parseFrame(frame)

    expect(parsed.type).toBe(0x9)
    expect(parsed.isLastPackage).toBe(true)
    expect(parsed.body).toEqual(body)
  })
})
