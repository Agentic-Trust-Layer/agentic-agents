import { useState, useEffect, useRef } from 'react'
import { A2AClient } from '@a2a-js/sdk/client'
import type { Message, TaskStatusUpdateEvent, AgentCard } from '@a2a-js/sdk'
import { v4 as uuidv4 } from 'uuid'

const MOVIE_AGENT_URL = 'http://movieagent.localhost:5002'
//const MOVIE_AGENT_URL = 'https://b07629d5.movie-agent.pages.dev'
// Use local backend server (same port as backend)
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000'

interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: Date
  status?: 'working' | 'completed' | 'failed'
}

interface FeedbackDialogProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (rating: number, comment: string) => Promise<void>
  agentName?: string
}

interface ConnectionErrorDialogProps {
  isOpen: boolean
  onClose: () => void
  agentUrl: string
}

function ConnectionErrorDialog({ isOpen, onClose, agentUrl }: ConnectionErrorDialogProps) {
  if (!isOpen) return null

  // Extract hostname and port from URL
  const url = new URL(agentUrl)
  const hostname = url.hostname
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  const needsHostsEntry = hostname !== 'localhost' && hostname !== '127.0.0.1'

  return (
    <div 
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 border border-red-500/50 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start space-x-4 mb-4">
          <div className="flex-shrink-0 w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
            <span className="text-2xl">⚠️</span>
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white mb-2">Failed to Connect to Movie Agent</h2>
            <p className="text-gray-300">
              Unable to reach the movie agent at <code className="bg-gray-700 px-2 py-1 rounded text-sm">{agentUrl}</code>
            </p>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-blue-300 mb-2">1. Start the Movie Agent</h3>
            <p className="text-gray-300 mb-2">Make sure your movie agent is running. From the project root, run:</p>
            <div className="bg-gray-900 rounded p-3 font-mono text-sm text-green-400 mb-2">
              <div>cd src/agents/movie-agent</div>
              <div>PORT=5002 pnpm dev</div>
            </div>
            <p className="text-gray-400 text-sm">Or from the project root:</p>
            <div className="bg-gray-900 rounded p-3 font-mono text-sm text-green-400">
              <div>PORT=5002 pnpm agents:movie-agent</div>
            </div>
          </div>

          {needsHostsEntry && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-yellow-300 mb-2">2. Configure Hostname Resolution</h3>
              <p className="text-gray-300 mb-2">
                If you haven't configured access to <code className="bg-gray-700 px-2 py-1 rounded text-sm">{hostname}:{port}</code>, 
                you need to add it to your <code className="bg-gray-700 px-2 py-1 rounded text-sm">/etc/hosts</code> file:
              </p>
              <div className="bg-gray-900 rounded p-3 font-mono text-sm text-green-400 mb-2">
                {`echo "127.0.0.1 ${hostname}" | sudo tee -a /etc/hosts`}
              </div>
              <p className="text-gray-400 text-sm">
                This maps <code className="bg-gray-700 px-1 rounded">{hostname}</code> to <code className="bg-gray-700 px-1 rounded">localhost</code>.
              </p>
            </div>
          )}

          <div className="bg-gray-700/50 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-2">Expected Agent Card URL:</h3>
            <code className="text-sm text-gray-400 break-all">{agentUrl}/.well-known/agent-card.json</code>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function FeedbackDialog({ isOpen, onClose, onSubmit, agentName }: FeedbackDialogProps) {
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!comment.trim()) {
      setError('Please enter a comment')
      return
    }
    setIsSubmitting(true)
    setError(null)
    setSuccess(false)
    try {
      await onSubmit(rating, comment)
      setSuccess(true)
      setComment('')
      setRating(5)
      // Close dialog after a short delay to show success message
      setTimeout(() => {
        setSuccess(false)
        onClose()
      }, 1500)
    } catch (err: any) {
      setError(err.message || 'Failed to submit feedback')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-white mb-4">Give Feedback</h2>
        {agentName && (
          <p className="text-sm text-gray-400 mb-4">Agent: {agentName}</p>
        )}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Rating
            </label>
            <div className="flex space-x-2">
              {[1, 2, 3, 4, 5].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setRating(num)}
                  className={`w-10 h-10 rounded-lg font-medium transition-colors ${
                    rating === num
                      ? 'bg-primary-500 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Comment
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Enter your feedback..."
              className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 border border-gray-600"
              rows={4}
              disabled={isSubmitting}
            />
          </div>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded-lg">
              <p className="text-red-300 text-sm whitespace-pre-line">{error}</p>
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-500/20 border border-green-500 rounded-lg">
              <p className="text-green-300 text-sm">Feedback submitted successfully!</p>
            </div>
          )}
          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !comment.trim()}
              className="flex-1 px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
            >
              {isSubmitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function App() {
  const [agentCard, setAgentCard] = useState<AgentCard | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentTaskId, setCurrentTaskId] = useState<string | undefined>()
  const [currentContextId, setCurrentContextId] = useState<string | undefined>()
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false)
  const [showConnectionErrorDialog, setShowConnectionErrorDialog] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<A2AClient | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        // Create A2A client
        console.log('get agent card from MOVIE_AGENT_URL', MOVIE_AGENT_URL)
        const client = new A2AClient(MOVIE_AGENT_URL, '.well-known/agent-card.json')
        clientRef.current = client
        
        // Fetch agent card
        const card = await client.getAgentCard()
        console.log('get agent card', card)

        
        setAgentCard(card)
        setMessages([{
          id: uuidv4(),
          role: 'agent',
          content: `Connected to ${card.name || 'Movie Agent'}. ${card.description || 'Ready to help with movie questions!'}`,
          timestamp: new Date(),
          status: 'completed'
        }])
      } catch (err: any) {
        const errorMsg = err.message || 'Unknown error'
        // Check if it's a connection/fetch error
        if (
          errorMsg.includes('Failed to fetch') ||
          errorMsg.includes('ERR_CONNECTION_REFUSED') ||
          errorMsg.includes('NetworkError') ||
          errorMsg.includes('network') ||
          errorMsg.includes('CORS') ||
          err.name === 'TypeError'
        ) {
          setShowConnectionErrorDialog(true)
        } else {
          setError(`Failed to connect: ${errorMsg}`)
        }
      }
    }
    init()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || isLoading || !clientRef.current) return

    const userInput = input.trim()
    
    // Check if user wants to give feedback
    if (checkForFeedbackIntent(userInput)) {
      setShowFeedbackDialog(true)
      setInput('')
      return
    }

    const userMessageId = uuidv4()
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: userInput,
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
        let messageProcessed = false // Track if we've already processed the final message content

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
                // Only process message content if we haven't already processed it
                if (!messageProcessed && statusEvent.status.message) {
                  const agentMessage = statusEvent.status.message
                  const textContent = agentMessage.parts
                    .filter((p: any) => p.kind === 'text')
                    .map((p: any) => p.text)
                    .join('\n')

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
                    messageProcessed = true
                  }
                }

                if (statusEvent.taskId) setCurrentTaskId(statusEvent.taskId)
                if (statusEvent.contextId) setCurrentContextId(statusEvent.contextId)
              } else if (state === 'failed') {
                setMessages(prev => prev.map(msg =>
                  msg.id === workingMessageId
                    ? { ...msg, content: (statusEvent.status.message?.parts?.[0] && statusEvent.status.message.parts[0].kind === 'text' ? statusEvent.status.message.parts[0].text : 'Error processing request') || 'Error processing request', status: 'failed' }
                    : msg
                ))
                messageProcessed = true
              }
            } else if (event.kind === 'message') {
              // Only process message events if we haven't already processed the content
              if (!messageProcessed) {
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
                  } else {
                    setMessages(prev => [...prev, {
                      id: uuidv4(),
                      role: 'agent',
                      content: textContent,
                      timestamp: new Date(),
                      status: 'completed'
                    }])
                  }
                  messageProcessed = true
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
            const firstPart = statusEvent.status.message?.parts?.[0]
            textContent = (firstPart && firstPart.kind === 'text' ? firstPart.text : 'Error processing request') || 'Error processing request'
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

  // Check if user input indicates they want to give feedback
  const checkForFeedbackIntent = (text: string): boolean => {
    const lowerText = text.toLowerCase().trim()
    const feedbackKeywords = ['give review', 'give feedback', 'leave review', 'leave feedback', 'rate', 'review', 'feedback']
    return feedbackKeywords.some(keyword => lowerText.includes(keyword))
  }

  // Helper function to create a timeout signal
  const createTimeoutSignal = (ms: number): AbortSignal => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), ms)
    return controller.signal
  }

  // Handle feedback submission
  const handleFeedbackSubmit = async (rating: number, comment: string) => {
    const agentName = agentCard?.name || 'movie-agent'
    
    // Check if backend is available
    let backendAvailable = false
    try {
      const testResp = await fetch(`${BACKEND_URL}/api/health`, {
        method: 'GET',
        signal: createTimeoutSignal(5000) // 5 second timeout
      })
      backendAvailable = testResp.ok || testResp.status === 200
    } catch (err: any) {
      // Connection refused or timeout
      const errorMsg = err.message || err.toString() || ''
      if (
        err.name === 'AbortError' || 
        errorMsg.includes('Failed to fetch') || 
        errorMsg.includes('ERR_CONNECTION_REFUSED') ||
        errorMsg.includes('NetworkError') ||
        errorMsg.includes('network')
      ) {
        throw new Error(
          `Backend server is not available at ${BACKEND_URL}.\n\n` +
          `To fix this:\n` +
          `1. Start the backend server: npm run dev:backend\n` +
          `2. Or run both frontend and backend: npm run dev:all\n` +
          `3. Ensure it's running on port 3000 (or set VITE_BACKEND_URL environment variable)`
        )
      }
      throw err
    }

    if (!backendAvailable) {
      throw new Error(
        `Backend server is not responding at ${BACKEND_URL}.\n\n` +
        `Please ensure the backend server is running.`
      )
    }
    
    // Get client address from backend
    let clientAddress = ''
    try {
      const addrResp = await fetch(`${BACKEND_URL}/api/config/client-address`, {
        signal: createTimeoutSignal(5000)
      })
      if (addrResp.ok) {
        const addrJson = await addrResp.json()
        clientAddress = (addrJson.clientAddress || '').trim()
      }
    } catch (err: any) {
      console.warn('Could not get client address from backend:', err)
      // Continue without client address - backend will try to resolve it
    }

    // Get feedbackAuth if we have client address and agent name
    let feedbackAuthId = ''
    if (clientAddress && agentName) {
      try {
        // taskRef is required - use taskId if available, otherwise contextId, otherwise generate one
        const taskRef = currentTaskId || currentContextId || `task-${Date.now()}`
        const faResp = await fetch(
          `${BACKEND_URL}/api/feedback-auth?clientAddress=${encodeURIComponent(clientAddress)}&agentName=${encodeURIComponent(agentName)}&taskRef=${encodeURIComponent(taskRef)}`,
          { signal: createTimeoutSignal(10000) }
        )
        if (faResp.ok) {
          const fa = await faResp.json()
          if (fa?.feedbackAuthId) {
            feedbackAuthId = fa.feedbackAuthId
          }
        }
      } catch (err) {
        console.warn('Could not get feedbackAuth:', err)
        // Continue without feedbackAuth - backend will try to resolve it
      }
    }

    // Submit feedback
    const response = await fetch(`${BACKEND_URL}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rating,
        comment,
        agentName,
        ...(currentTaskId && { taskId: currentTaskId }),
        ...(currentContextId && { contextId: currentContextId }),
        ...(feedbackAuthId && { feedbackAuthId }),
      }),
      signal: createTimeoutSignal(30000) // 30 second timeout for submission
    })

    if (!response.ok) {
      let errorMessage = 'Failed to submit feedback'
      try {
        const result = await response.json()
        errorMessage = result.error || errorMessage
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`
      }
      throw new Error(errorMessage)
    }

    const result = await response.json()
    return result
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
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center space-x-4">
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
            </div>
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              className="px-6 h-[42px] bg-primary-500 hover:bg-primary-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
            >
              Send
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1 ml-0">Press Enter to send, Shift+Enter for new line</p>
        </div>
      </div>

      {/* Feedback Dialog */}
      <FeedbackDialog
        isOpen={showFeedbackDialog}
        onClose={() => setShowFeedbackDialog(false)}
        onSubmit={handleFeedbackSubmit}
        agentName={agentCard?.name}
      />

      {/* Connection Error Dialog */}
      <ConnectionErrorDialog
        isOpen={showConnectionErrorDialog}
        onClose={() => setShowConnectionErrorDialog(false)}
        agentUrl={MOVIE_AGENT_URL}
      />
    </div>
  )
}

export default App
