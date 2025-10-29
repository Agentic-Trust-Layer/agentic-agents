import { useState, useEffect, useRef } from 'react'
import { A2AClient } from '@a2a-js/sdk/client'
import type { Message, TaskStatusUpdateEvent, TaskArtifactUpdateEvent, AgentCard } from '@a2a-js/sdk'
import { v4 as uuidv4 } from 'uuid'

const MOVIE_AGENT_URL = 'https://b3b17ea0.movie-agent.pages.dev'

interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: Date
  status?: 'working' | 'completed' | 'failed'
}

function App() {
  const [agentCard, setAgentCard] = useState<AgentCard | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentTaskId, setCurrentTaskId] = useState<string | undefined>()
  const [currentContextId, setCurrentContextId] = useState<string | undefined>()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<A2AClient | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        // Create A2A client
        const client = new A2AClient(MOVIE_AGENT_URL, '.well-known/agent-card.json')
        clientRef.current = client
        
        // Fetch agent card
        const card = await client.getAgentCard()
        

        
        setAgentCard(card)
        setMessages([{
          id: uuidv4(),
          role: 'agent',
          content: `Connected to ${card.name || 'Movie Agent'}. ${card.description || 'Ready to help with movie questions!'}`,
          timestamp: new Date(),
          status: 'completed'
        }])
      } catch (err: any) {
        setError(`Failed to connect: ${err.message}`)
      }
    }
    init()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || isLoading || !clientRef.current) return

    const userMessageId = uuidv4()
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    setError(null)

    try {
      // Ensure service endpoint is set to the correct URL
      if (clientRef.current) {
        ;(clientRef.current as any).serviceEndpointUrl = MOVIE_AGENT_URL
      }

      const messagePayload: Message = {
        messageId: uuidv4(),
        kind: 'message',
        role: 'user',
        parts: [{ kind: 'text', text: userMessage.content }],
        ...(currentTaskId && { taskId: currentTaskId }),
        ...(currentContextId && { contextId: currentContextId })
      }

      // Check if agent supports streaming
      const supportsStreaming = agentCard?.capabilities?.streaming === true
      
      if (supportsStreaming) {
        // Use streaming for real-time updates
        const stream = clientRef.current.sendMessageStream({
          message: messagePayload
        })

        let workingMessageId: string | null = null

        for await (const event of stream) {
          try {
            if (event.kind === 'status-update') {
              const statusEvent = event as TaskStatusUpdateEvent
              const state = statusEvent.status.state

              if (state === 'working') {
                if (!workingMessageId) {
                  workingMessageId = uuidv4()
                  setMessages(prev => [...prev, {
                    id: workingMessageId!,
                    role: 'agent',
                    content: 'Thinking...',
                    timestamp: new Date(),
                    status: 'working'
                  }])
                } else {
                  // Update existing working message
                  setMessages(prev => prev.map(msg =>
                    msg.id === workingMessageId && msg.status === 'working'
                      ? { ...msg, content: 'Processing...' }
                      : msg
                  ))
                }
              } else if (state === 'completed') {
                let textContent = ''
                if (statusEvent.status.message) {
                  const agentMessage = statusEvent.status.message
                  textContent = agentMessage.parts
                    .filter((p: any) => p.kind === 'text')
                    .map((p: any) => p.text)
                    .join('\n')
                }

                if (textContent) {
                  if (workingMessageId) {
                    setMessages(prev => prev.map(msg =>
                      msg.id === workingMessageId
                        ? { ...msg, content: textContent, status: 'completed' }
                        : msg
                    ))
                  } else {
                    setMessages(prev => [...prev, {
                      id: uuidv4(),
                      role: 'agent',
                      content: textContent,
                      timestamp: new Date(),
                      status: 'completed'
                    }])
                  }
                }

                if (statusEvent.taskId) setCurrentTaskId(statusEvent.taskId)
                if (statusEvent.contextId) setCurrentContextId(statusEvent.contextId)
              } else if (state === 'failed') {
                setMessages(prev => prev.map(msg =>
                  msg.id === workingMessageId
                    ? { ...msg, content: statusEvent.status.message?.parts?.[0]?.text || 'Error processing request', status: 'failed' }
                    : msg
                ))
              }
            } else if (event.kind === 'message') {
              const messageEvent = event as Message
              const textContent = messageEvent.parts
                .filter((p: any) => p.kind === 'text')
                .map((p: any) => p.text)
                .join('\n')

              if (textContent) {
                if (messageEvent.taskId) setCurrentTaskId(messageEvent.taskId)
                if (messageEvent.contextId) setCurrentContextId(messageEvent.contextId)

                if (workingMessageId) {
                  setMessages(prev => prev.map(msg =>
                    msg.id === workingMessageId
                      ? { ...msg, content: textContent, status: 'completed' }
                      : msg
                  ))
                  workingMessageId = null
                } else {
                  setMessages(prev => [...prev, {
                    id: uuidv4(),
                    role: 'agent',
                    content: textContent,
                    timestamp: new Date(),
                    status: 'completed'
                  }])
                }
              }
            }
          } catch (eventError: any) {
            console.error('Error processing event:', eventError)
          }
        }
      } else {
        // Use non-streaming message sending
        const workingMessageId = uuidv4()
        setMessages(prev => [...prev, {
          id: workingMessageId,
          role: 'agent',
          content: 'Processing...',
          timestamp: new Date(),
          status: 'working'
        }])

        const response = await clientRef.current.sendMessage({
          message: messagePayload
        }) as any

        // Process the response - could be TaskStatusUpdateEvent, Message, or Task
        let textContent = ''
        let responseTaskId: string | undefined
        let responseContextId: string | undefined
        let responseStatus: 'completed' | 'failed' = 'completed'

        if (response.kind === 'status-update') {
          const statusEvent = response as TaskStatusUpdateEvent
          responseTaskId = statusEvent.taskId
          responseContextId = statusEvent.contextId
          
          if (statusEvent.status.state === 'completed' && statusEvent.status.message) {
            const agentMessage = statusEvent.status.message
            textContent = agentMessage.parts
              .filter((p: any) => p.kind === 'text')
              .map((p: any) => p.text)
              .join('\n')
          } else if (statusEvent.status.state === 'failed') {
            responseStatus = 'failed'
            textContent = statusEvent.status.message?.parts?.[0]?.text || 'Error processing request'
          }
        } else if (response.kind === 'message') {
          const messageEvent = response as Message
          textContent = messageEvent.parts
            .filter((p: any) => p.kind === 'text')
            .map((p: any) => p.text)
            .join('\n')
          responseTaskId = messageEvent.taskId
          responseContextId = messageEvent.contextId
        } else if (response.id) {
          // Task object
          responseTaskId = response.id
          responseContextId = response.contextId
          if (response.status?.message) {
            textContent = response.status.message.parts
              .filter((p: any) => p.kind === 'text')
              .map((p: any) => p.text)
              .join('\n')
          }
        }

        if (textContent) {
          setMessages(prev => prev.map(msg =>
            msg.id === workingMessageId
              ? { ...msg, content: textContent, status: responseStatus }
              : msg
          ))

          if (responseTaskId) setCurrentTaskId(responseTaskId)
          if (responseContextId) setCurrentContextId(responseContextId)
        } else {
          setMessages(prev => prev.map(msg =>
            msg.id === workingMessageId
              ? { ...msg, content: 'No response content received', status: 'failed' }
              : msg
          ))
        }
      }

    } catch (err: any) {
      setError(err.message || 'Failed to send message')
      setMessages(prev => [...prev, {
        id: uuidv4(),
        role: 'agent',
        content: `Error: ${err.message || 'Failed to process request'}`,
        timestamp: new Date(),
        status: 'failed'
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleNewSession = () => {
    setCurrentTaskId(undefined)
    setCurrentContextId(undefined)
    setMessages(agentCard ? [{
      id: uuidv4(),
      role: 'agent',
      content: `New session started. Connected to ${agentCard.name || 'Movie Agent'}.`,
      timestamp: new Date(),
      status: 'completed'
    }] : [])
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary-500 rounded-lg flex items-center justify-center">
              <span className="text-2xl">🎬</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                {agentCard?.name || 'Movie Agent'}
              </h1>
              <p className="text-sm text-gray-400">
                {agentCard ? `${agentCard.version || 'v1.0'} • Streaming Supported` : 'Connecting...'}
              </p>
            </div>
          </div>
          <button
            onClick={handleNewSession}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm font-medium"
          >
            New Session
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/20 border-b border-red-500 px-6 py-3">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`${msg.role === 'user' ? 'message-user' : 'message-agent'} ${msg.status === 'working' ? 'status-working border-2' : msg.status === 'failed' ? 'status-failed border-2' : ''}`}>
              <div className="flex items-start space-x-2">
                {msg.role === 'agent' && (
                  <span className="text-xl mt-1">
                    {msg.status === 'working' ? '⏳' : msg.status === 'failed' ? '❌' : '🤖'}
                  </span>
                )}
                <div className="flex-1">
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  <p className="text-xs opacity-70 mt-1">
                    {msg.timestamp.toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="message-agent status-working border-2">
              <div className="flex items-center space-x-2">
                <span className="text-xl">⏳</span>
                <p>Processing...</p>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-gray-800 border-t border-gray-700 px-6 py-4">
        <div className="flex items-end space-x-4 max-w-4xl mx-auto">
          <div className="flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about movies, actors, directors..."
              className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 border border-gray-600"
              rows={1}
              disabled={isLoading}
            />
            <p className="text-xs text-gray-500 mt-1">Press Enter to send, Shift+Enter for new line</p>
          </div>
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="px-6 py-3 bg-primary-500 hover:bg-primary-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
