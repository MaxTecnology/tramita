import { describe, it, expect } from 'vitest'
import { contentMatchesType } from './upload-policy'

const bytes = (...b: number[]) => Buffer.from(b)
const text = (s: string) => Buffer.from(s, 'latin1')

describe('o conteúdo do arquivo confere com a extensão', () => {
  it.each([
    ['application/pdf', text('%PDF-1.7\n...')],
    ['image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)],
    ['image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0, 0)],
    ['image/gif', text('GIF89a....')],
    ['image/webp', Buffer.concat([text('RIFF'), bytes(0, 0, 0, 0), text('WEBPVP8 ')])],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes(0x50, 0x4b, 0x03, 0x04, 0)],
    ['application/zip', bytes(0x50, 0x4b, 0x03, 0x04, 0)],
    ['application/msword', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)],
    ['text/csv', text('cnpj;valor\n123;10,00\n')],
    ['application/xml', text('<?xml version="1.0"?><nfeProc/>')],
    ['application/x-ofx', text('OFXHEADER:100\nDATA:OFXSGML\n')],
  ])('accepts a real %s', (mime, buffer) => {
    expect(contentMatchesType(mime, buffer)).toBe(true)
  })

  it.each([
    ['application/pdf', text('MZ\x90\x00 executável renomeado')],
    ['application/pdf', text('<html><script>alert(1)</script>')],
    ['image/png', text('%PDF-1.7')],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', text('MZ')],
    ['text/csv', bytes(0x4d, 0x5a, 0x00, 0x00, 0x01)],
    ['application/pdf', Buffer.alloc(0)],
  ])('refuses %s whose content is something else', (mime, buffer) => {
    expect(contentMatchesType(mime, buffer)).toBe(false)
  })
})
