import { useRef, useState, useEffect, useCallback } from 'react'
import { List } from 'react-window'
import { MessageLine } from './MessageLine'

const ROW_HEIGHT = 36
const VIRTUALIZE_THRESHOLD = 100

/**
 * Renders messages in a virtualized list when there are many (>= VIRTUALIZE_THRESHOLD),
 * otherwise renders normally so scroll-to-bottom and layout behave as before.
 */
export function VirtualizedMessageList({ messages, now, messagesEndRef }) {
  const containerRef = useRef(null)
  const listRef = useRef(null)
  const [height, setHeight] = useState(0)
  const prevCountRef = useRef(0)

  const normalized = messages.map((m) =>
    typeof m === 'string' ? { line: m, burnTs: null } : m
  )
  const visible = normalized.filter((m) => m.burnTs == null || now <= m.burnTs)
  const useVirtual = visible.length >= VIRTUALIZE_THRESHOLD

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { height: h } = entries[0]?.contentRect ?? {}
      if (typeof h === 'number' && h > 0) setHeight(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!useVirtual || !listRef.current) return
    const prev = prevCountRef.current
    prevCountRef.current = visible.length
    if (visible.length > prev)
      listRef.current.scrollToItem(visible.length - 1, 'end')
  }, [visible.length, useVirtual])

  const Row = useCallback(
    ({ index, style }) => (
      <div style={style}>
        <MessageLine line={visible[index].line} />
      </div>
    ),
    [visible]
  )

  if (!useVirtual) {
    return (
      <div className="messages" role="log" ref={containerRef}>
        {visible.map((m, i) => (
          <MessageLine key={i} line={m.line} />
        ))}
        <div ref={messagesEndRef} />
      </div>
    )
  }

  if (height <= 0) {
    return (
      <div
        className="messages messages-virtual-placeholder"
        role="log"
        ref={containerRef}
      />
    )
  }

  return (
    <div
      className="messages messages-virtual"
      role="log"
      ref={containerRef}
      style={{ height: '100%' }}
    >
      <List
        ref={listRef}
        height={height}
        width="100%"
        itemCount={visible.length}
        itemSize={ROW_HEIGHT}
        overscanCount={10}
        style={{ overflowX: 'hidden' }}
      >
        {Row}
      </List>
    </div>
  )
}
