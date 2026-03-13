export function MessageLine({ line }) {
  const systemMatch = line.match(/^\*\*\* (.+) \*\*\*$/)
  const chatMatch = line.match(/^\[([^\]]+)\]: (.+)$/)
  if (systemMatch) {
    return <div className="line system">{systemMatch[1]}</div>
  }
  if (chatMatch) {
    return (
      <div className="line chat">
        <span className="user">{chatMatch[1]}:</span> {chatMatch[2]}
      </div>
    )
  }
  if (
    line.startsWith('Recent messages') ||
    line.startsWith('  [') ||
    line.startsWith('Users in') ||
    line.startsWith('  - ') ||
    line.startsWith('Rooms:') ||
    line.startsWith('  #')
  ) {
    return <div className="line meta">{line}</div>
  }
  if (line.startsWith('Commands:') || line.startsWith('  /')) {
    return <div className="line meta commands-block">{line}</div>
  }
  return <div className="line">{line}</div>
}
