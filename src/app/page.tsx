'use client';

import { useState, useRef, useEffect } from 'react';
import { Copy, Send, Trash2, Wifi, WifiOff, Settings, Check, X } from 'lucide-react';

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface Message {
  text: string;
  type: 'sent' | 'received' | 'system' | 'error' | 'ice-debug';
  timestamp: string;
}

interface ICECandidateInfo {
  candidate: string;
  type: string;
  protocol: string;
  address: string;
  port: number;
  priority: number;
  foundation: string;
}

export default function WebRTCDataTest() {
  const [isInitiator, setIsInitiator] = useState<boolean>(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [iceState, setIceState] = useState<RTCIceConnectionState>('new');
  const [dataChannelState, setDataChannelState] = useState<RTCDataChannelState>('closed');
  const [localOffer, setLocalOffer] = useState<string>('');
  const [localAnswer, setLocalAnswer] = useState<string>('');
  const [remoteOffer, setRemoteOffer] = useState<string>('');
  const [remoteAnswer, setRemoteAnswer] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [iceServers, setIceServers] = useState<IceServer[]>([]);
  const [iceServersLoading, setIceServersLoading] = useState<boolean>(true);
  const [mediaPermissionState, setMediaPermissionState] = useState<'none' | 'requesting' | 'granted' | 'denied'>('none');
  const [hasMediaStream, setHasMediaStream] = useState<boolean>(false);
  
  // Custom ICE servers configuration
  const [showCustomIceConfig, setShowCustomIceConfig] = useState<boolean>(false);
  const [customIceServersText, setCustomIceServersText] = useState<string>('');
  const [usingCustomIceServers, setUsingCustomIceServers] = useState<boolean>(false);
  const [customIceServersError, setCustomIceServersError] = useState<string>('');

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const localCandidates = useRef<Map<string, ICECandidateInfo>>(new Map());
  const remoteCandidates = useRef<Map<string, ICECandidateInfo>>(new Map());
  const candidatePairs = useRef<Map<string, { local: string; remote: string; state: string }>>(new Map());

  // Request media permissions (helps with Firefox and other browsers)
  const requestMediaPermissions = async (): Promise<boolean> => {
    try {
      setMediaPermissionState('requesting');
      addMessage('🎤 Requesting microphone permission (helps with browser compatibility)...', 'system');
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 8000, // Low quality to minimize resource usage
          channelCount: 1
        } 
      });
      
      localStream.current = stream;
      setHasMediaStream(true);
      setMediaPermissionState('granted');
      addMessage('✅ Microphone permission granted (will improve connection reliability)', 'system');
      
      // Mute the audio track immediately to prevent feedback
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = false;
        addMessage('🔇 Audio muted (only needed for WebRTC compatibility)', 'system');
      }
      
      return true;
    } catch (error) {
      setMediaPermissionState('denied');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addMessage(`⚠️ Media permission denied: ${errorMessage}`, 'error');
      addMessage('Note: Data channels may still work, but connection reliability may be reduced', 'system');
      return false;
    }
  };

  // Clean up media stream
  const cleanupMediaStream = (): void => {
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => {
        track.stop();
      });
      localStream.current = null;
      setHasMediaStream(false);
      addMessage('🔇 Released microphone', 'system');
    }
  };

  // Apply custom ICE servers configuration
  const applyCustomIceServers = (): void => {
    try {
      setCustomIceServersError('');
      if (!customIceServersText.trim()) {
        setCustomIceServersError('Please enter ICE servers configuration');
        return;
      }

      const parsedServers: IceServer[] = JSON.parse(customIceServersText);
      
      // Validate the structure
      if (!Array.isArray(parsedServers)) {
        throw new Error('ICE servers must be an array');
      }

      for (const server of parsedServers) {
        if (!server.urls) {
          throw new Error('Each ICE server must have a "urls" property');
        }
        if (typeof server.urls !== 'string' && !Array.isArray(server.urls)) {
          throw new Error('ICE server "urls" must be a string or array of strings');
        }
      }

      setIceServers(parsedServers);
      setUsingCustomIceServers(true);
      setShowCustomIceConfig(false);
      addMessage(`✅ Applied ${parsedServers.length} custom ICE server(s)`, 'system');
      
      // Log the servers being used
      parsedServers.forEach((server, index) => {
        const urls = Array.isArray(server.urls) ? server.urls.join(', ') : server.urls;
        const credentials = server.username ? ' (with credentials)' : '';
        addMessage(`   Server ${index + 1}: ${urls}${credentials}`, 'ice-debug');
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setCustomIceServersError(`Invalid JSON or structure: ${errorMessage}`);
    }
  };

  // Reset to default ICE servers
  const resetToDefaultIceServers = async (): Promise<void> => {
    setUsingCustomIceServers(false);
    setCustomIceServersText('');
    setCustomIceServersError('');
    await fetchDefaultIceServers();
  };

  // Fetch default ICE servers
  const fetchDefaultIceServers = async (): Promise<void> => {
    try {
      setIceServersLoading(true);
      addMessage('🌐 Loading default ICE servers...', 'system');
      
      const response = await fetch('/api/ice', {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const { iceServers: servers }: { iceServers: IceServer[] } = await response.json();
      setIceServers(servers);
      addMessage(`✅ Loaded ${servers.length} default ICE server(s)`, 'system');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addMessage(`⚠️ Failed to load default ICE servers: ${errorMessage}`, 'error');
      // Fallback to default STUN servers
      const fallbackServers: IceServer[] = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ];
      setIceServers(fallbackServers);
      addMessage('Using fallback STUN servers', 'system');
    } finally {
      setIceServersLoading(false);
    }
  };

  const parseICECandidate = (candidate: RTCIceCandidate): ICECandidateInfo | null => {
    try {
      const parts = candidate.candidate.split(' ');
      if (parts.length < 6) return null;

      return {
        candidate: candidate.candidate,
        type: candidate.type || 'unknown',
        protocol: parts[2]?.toLowerCase() || 'unknown',
        address: parts[4] || 'unknown',
        port: parseInt(parts[5]) || 0,
        priority: parseInt(parts[3]) || 0,
        foundation: parts[0] || 'unknown'
      };
    } catch {
      return null;
    }
  };

  // Helper function to analyze why a connection failed
  const analyzeConnectionFailure = (pair: any, localCandidate: any, remoteCandidate: any) => {
    const analysis = {
      reason: 'Connection failed',
      details: '',
      suggestions: [] as string[]
    };

    // Check packet exchange patterns
    const sentPackets = pair.requestsSent || 0;
    const receivedPackets = pair.requestsReceived || 0;
    const sentResponses = pair.responsesSent || 0;
    const receivedResponses = pair.responsesReceived || 0;

    // Analyze based on packet patterns
    if (sentPackets === 0 && receivedPackets === 0) {
      analysis.reason = 'No communication attempted - candidate pair was not selected for testing';
      analysis.details = 'This path was deprioritized or testing was stopped early';
    } else if (sentPackets > 0 && receivedPackets === 0) {
      analysis.reason = 'Outbound packets sent but no response received';
      analysis.details = `Sent ${sentPackets} requests, received 0 responses`;
      
      // Specific analysis based on candidate types
      if (localCandidate.candidateType === 'relay' || remoteCandidate.candidateType === 'relay') {
        analysis.suggestions.push('TURN server may be unreachable or credentials invalid');
        analysis.suggestions.push('Check TURN server configuration and network connectivity');
      } else if (localCandidate.candidateType === 'srflx' || remoteCandidate.candidateType === 'srflx') {
        analysis.suggestions.push('NAT/Firewall may be blocking incoming connections');
        analysis.suggestions.push('STUN server may have provided incorrect reflexive address');
      } else if (localCandidate.candidateType === 'host' && remoteCandidate.candidateType === 'host') {
        analysis.suggestions.push('Direct connection blocked - peers may be on different networks');
        analysis.suggestions.push('Firewall or network policy preventing direct communication');
      }
    } else if (sentPackets > 0 && receivedPackets > 0 && receivedResponses === 0) {
      analysis.reason = 'Partial communication - requests received but responses not getting back';
      analysis.details = `Sent ${sentPackets} requests, received ${receivedPackets} requests, but no responses returned`;
      analysis.suggestions.push('Asymmetric routing issue - return path may be blocked');
      analysis.suggestions.push('Remote peer may have connectivity issues');
    } else if (receivedResponses > 0 && sentResponses === 0) {
      analysis.reason = 'Response delivery failure - unable to send responses back';
      analysis.details = `Received ${receivedResponses} responses but couldn\'t send any back`;
      analysis.suggestions.push('Local network may be blocking outbound responses');
    } else {
      analysis.reason = 'Communication timeout or authentication failure';
      analysis.details = `Sent: ${sentPackets} requests, ${sentResponses} responses | Received: ${receivedPackets} requests, ${receivedResponses} responses`;
    }

    // Add protocol-specific analysis
    if (localCandidate.protocol !== remoteCandidate.protocol) {
      analysis.suggestions.push(`Protocol mismatch: ${localCandidate.protocol} vs ${remoteCandidate.protocol}`);
    }

    // Add timing analysis if available
    if (pair.lastPacketSentTimestamp && pair.lastPacketReceivedTimestamp) {
      const timeDiff = pair.lastPacketReceivedTimestamp - pair.lastPacketSentTimestamp;
      if (timeDiff > 5000) { // More than 5 seconds
        analysis.details += ` | Large time gap (${Math.round(timeDiff/1000)}s) suggests network instability`;
      }
    }

    // Add network topology insights
    const networkInsight = getNetworkTopologyInsight(localCandidate, remoteCandidate);
    if (networkInsight) {
      analysis.suggestions.push(networkInsight);
    }

    return analysis;
  };

  // Helper function to provide network topology insights
  const getNetworkTopologyInsight = (localCandidate: any, remoteCandidate: any): string => {
    const localType = localCandidate.candidateType;
    const remoteType = remoteCandidate.candidateType;

    if (localType === 'host' && remoteType === 'host') {
      return 'Direct peer-to-peer attempt - both peers must be on same network or have public IPs';
    } else if (localType === 'host' && remoteType === 'srflx') {
      return 'Local is direct, remote is behind NAT - remote may not accept incoming connections';
    } else if (localType === 'srflx' && remoteType === 'srflx') {
      return 'Both peers behind NAT - may need TURN relay if NAT types are incompatible';
    } else if (localType === 'relay' || remoteType === 'relay') {
      return 'Using TURN relay - should work unless TURN server is misconfigured';
    } else if (localType === 'prflx' || remoteType === 'prflx') {
      return 'Peer-reflexive discovery - connection path found during connectivity checks';
    }
    
    return '';
  };

  const getCandidateTypeDescription = (type: string): string => {
    const types: Record<string, string> = {
      'host': 'Direct connection (same network)',
      'srflx': 'Server reflexive (through NAT/firewall)',
      'prflx': 'Peer reflexive (discovered during connectivity)',
      'relay': 'Relayed (through TURN server)'
    };
    return types[type] || `Unknown type (${type})`;
  };

  // Load ICE servers on component mount
  useEffect(() => {
    if (!usingCustomIceServers) {
      fetchDefaultIceServers();
    }
  }, [usingCustomIceServers]);

  // Initialize WebRTC
  const initializeWebRTC = async (asInitiator: boolean = false): Promise<void> => {
    try {
      // Clear previous candidates
      localCandidates.current.clear();
      remoteCandidates.current.clear();
      candidatePairs.current.clear();

      // Request media permissions first (especially important for Firefox)
      let mediaGranted = false;
      if (mediaPermissionState === 'none') {
        mediaGranted = await requestMediaPermissions();
      } else if (mediaPermissionState === 'granted') {
        mediaGranted = true;
      }

      // Create peer connection with ICE servers
      peerConnection.current = new RTCPeerConnection({
        iceServers: iceServers,
        iceCandidatePoolSize: 10
      });

      const iceServerType = usingCustomIceServers ? 'custom' : 'default';
      addMessage(`🔧 Initialized WebRTC with ${iceServers.length} ${iceServerType} ICE servers`, 'ice-debug');
      
      // Add media stream tracks if available (helps with connectivity)
      if (localStream.current && mediaGranted) {
        localStream.current.getTracks().forEach(track => {
          if (peerConnection.current) {
            peerConnection.current.addTrack(track, localStream.current!);
          }
        });
        addMessage('🎵 Added media tracks to connection (improves browser compatibility)', 'ice-debug');
      }

      // Set up event listeners
      peerConnection.current.onconnectionstatechange = (): void => {
        if (!peerConnection.current) return;
        setConnectionState(peerConnection.current.connectionState);
        const stateMessages: Record<RTCPeerConnectionState, string> = {
          'new': 'Ready to connect',
          'connecting': 'Connecting to peer...',
          'connected': '✅ Connected to peer!',
          'disconnected': 'Connection lost',
          'failed': '❌ Connection failed',
          'closed': 'Connection closed'
        };
        addMessage(stateMessages[peerConnection.current.connectionState] || `Connection: ${peerConnection.current.connectionState}`, 'system');
        
        if (peerConnection.current.connectionState === 'failed') {
          addMessage('🔍 Connection failed - checking ICE candidate details...', 'ice-debug');
          logCandidateFailures();
        }
      };

      peerConnection.current.oniceconnectionstatechange = (): void => {
        if (!peerConnection.current) return;
        setIceState(peerConnection.current.iceConnectionState);
        const iceMessages: Record<RTCIceConnectionState, string> = {
          'new': 'Starting connection process',
          'checking': 'Testing connection paths...',
          'connected': '✅ Found working connection path!',
          'completed': '✅ Connection optimized',
          'disconnected': 'Connection interrupted',
          'failed': '❌ Could not connect',
          'closed': 'Connection closed'
        };
        addMessage(iceMessages[peerConnection.current.iceConnectionState] || `Network: ${peerConnection.current.iceConnectionState}`, 'system');
        
        if (peerConnection.current.iceConnectionState === 'checking') {
          addMessage('🔍 Starting connectivity checks between candidates...', 'ice-debug');
        } else if (peerConnection.current.iceConnectionState === 'failed') {
          addMessage('❌ All connectivity checks failed', 'ice-debug');
          logCandidateFailures();
        } else if (peerConnection.current.iceConnectionState === 'connected') {
          addMessage('🎉 Connection established! Analyzing successful path...', 'ice-debug');
          setTimeout(() => logSuccessfulConnection(), 500); // Small delay to ensure stats are available
        }
      };

      peerConnection.current.onicegatheringstatechange = (): void => {
        if (!peerConnection.current) return;
        const gatheringMessages: Record<RTCIceGatheringState, string> = {
          'new': 'Getting ready to find connection paths',
          'gathering': '🔍 Finding ways to connect...',
          'complete': '✅ Found all possible connection paths'
        };
        addMessage(gatheringMessages[peerConnection.current.iceGatheringState] || `Gathering: ${peerConnection.current.iceGatheringState}`, 'system');
        
        if (peerConnection.current.iceGatheringState === 'complete') {
          addMessage(`📊 Gathered ${localCandidates.current.size} local candidates`, 'ice-debug');
          logCandidateSummary();
        }
      };

      peerConnection.current.onicecandidate = (event: RTCPeerConnectionIceEvent): void => {
        if (event.candidate) {
          const candidateInfo = parseICECandidate(event.candidate);
          if (candidateInfo) {
            localCandidates.current.set(event.candidate.foundation as any, candidateInfo);
            const typeDesc = getCandidateTypeDescription(candidateInfo.type);
            addMessage(`🔍 Found local candidate: ${candidateInfo.type} (${candidateInfo.protocol.toUpperCase()}) ${candidateInfo.address}:${candidateInfo.port} - ${typeDesc}`, 'ice-debug');
          } else {
            addMessage(`Found connection path: ${event.candidate.type || 'unknown'}`, 'system');
          }
        } else {
          addMessage('Finished finding connection paths', 'system');
        }
      };

      // Add ICE candidate error logging
      peerConnection.current.addEventListener('icecandidateerror', (event: any) => {
        addMessage(`❌ ICE candidate error: ${event.errorText || 'Unknown error'} (Code: ${event.errorCode || 'N/A'})`, 'ice-debug');
        if (event.url) {
          addMessage(`   Failed server: ${event.url}`, 'ice-debug');
        }
      });

      setIsInitiator(asInitiator);

      if (asInitiator) {
        // Create data channel (initiator)
        dataChannel.current = peerConnection.current.createDataChannel('messages', {
          ordered: true
        });
        setupDataChannel();
        addMessage('Initialized as initiator - ready to create connection offer', 'system');
      } else {
        // Listen for data channel (receiver)
        peerConnection.current.ondatachannel = (event: RTCDataChannelEvent): void => {
          dataChannel.current = event.channel;
          setupDataChannel();
          addMessage('📨 Received data channel from peer', 'system');
        };
        addMessage('Initialized as receiver - waiting for connection offer', 'system');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addMessage(`Error initializing WebRTC: ${errorMessage}`, 'error');
    }
  };

  const logCandidateSummary = (): void => {
    const candidateTypes = new Map();
    localCandidates.current.forEach((candidate) => {
      const count = candidateTypes.get(candidate.type) || 0;
      candidateTypes.set(candidate.type, count + 1);
    });

    addMessage('📊 Local candidate summary:', 'ice-debug');
    candidateTypes.forEach((count, type) => {
      const typeDesc = getCandidateTypeDescription(type);
      addMessage(`   • ${count}x ${type} - ${typeDesc}`, 'ice-debug');
    });
  };

  const logCandidateFailures = async (): Promise<void> => {
    if (!peerConnection.current) return;

    try {
      const stats = await peerConnection.current.getStats();
      const candidatePairStats: any[] = [];
      const localCandidateStats = new Map();
      const remoteCandidateStats = new Map();

      stats.forEach((report) => {
        if (report.type === 'candidate-pair') {
          candidatePairStats.push(report);
        } else if (report.type === 'local-candidate') {
          localCandidateStats.set(report.id, report);
        } else if (report.type === 'remote-candidate') {
          remoteCandidateStats.set(report.id, report);
        }
      });

      addMessage('🔍 Detailed connectivity check results:', 'ice-debug');
      
      // Group candidate pairs by status for better organization
      const succeededPairs = candidatePairStats.filter(pair => pair.state === 'succeeded');
      const failedPairs = candidatePairStats.filter(pair => pair.state === 'failed');
      const inProgressPairs = candidatePairStats.filter(pair => pair.state === 'in-progress');
      const waitingPairs = candidatePairStats.filter(pair => pair.state === 'waiting');
      
      // Show successful pairs first
      if (succeededPairs.length > 0) {
        addMessage(`✅ ${succeededPairs.length} successful connection(s):`, 'ice-debug');
        succeededPairs.forEach((pair) => {
          const localCandidate = localCandidateStats.get(pair.localCandidateId);
          const remoteCandidate = remoteCandidateStats.get(pair.remoteCandidateId);
          
          if (localCandidate && remoteCandidate) {
            const localInfo = `${localCandidate.candidateType} ${localCandidate.address}:${localCandidate.port} (${localCandidate.protocol})`;
            const remoteInfo = `${remoteCandidate.candidateType} ${remoteCandidate.address}:${remoteCandidate.port} (${remoteCandidate.protocol})`;
            const nominated = pair.nominated ? ' [NOMINATED]' : '';
            addMessage(`   ✅ ${localInfo} ↔ ${remoteInfo}${nominated}`, 'ice-debug');
          }
        });
      }
      
      // Show failed pairs with detailed analysis
      if (failedPairs.length > 0) {
        addMessage(`❌ ${failedPairs.length} failed connection(s):`, 'ice-debug');
        failedPairs.forEach((pair) => {
          const localCandidate = localCandidateStats.get(pair.localCandidateId);
          const remoteCandidate = remoteCandidateStats.get(pair.remoteCandidateId);
          
          if (localCandidate && remoteCandidate) {
            const localInfo = `${localCandidate.candidateType} ${localCandidate.address}:${localCandidate.port} (${localCandidate.protocol})`;
            const remoteInfo = `${remoteCandidate.candidateType} ${remoteCandidate.address}:${remoteCandidate.port} (${remoteCandidate.protocol})`;
            
            // Analyze the failure in detail
            const failureAnalysis = analyzeConnectionFailure(pair, localCandidate, remoteCandidate);
            
            addMessage(`   ❌ ${localInfo} ↔ ${remoteInfo}`, 'ice-debug');
            addMessage(`      💡 ${failureAnalysis.reason}`, 'ice-debug');
            addMessage(`      📊 ${failureAnalysis.details}`, 'ice-debug');
            
            if (failureAnalysis.suggestions.length > 0) {
              failureAnalysis.suggestions.forEach(suggestion => {
                addMessage(`      🔧 ${suggestion}`, 'ice-debug');
              });
            }
          }
        });
      }
      
      // Show other states
      if (inProgressPairs.length > 0) {
        addMessage(`🔄 ${inProgressPairs.length} connection(s) still testing...`, 'ice-debug');
      }
      
      if (waitingPairs.length > 0) {
        addMessage(`⏳ ${waitingPairs.length} connection(s) waiting to be tested`, 'ice-debug');
      }

      if (candidatePairStats.length === 0) {
        addMessage('   No candidate pairs found - connection may not have started properly', 'ice-debug');
      }

    } catch (error) {
      addMessage(`Error getting connection stats: ${error}`, 'ice-debug');
    }
  };

  const logSuccessfulConnection = async (): Promise<void> => {
    if (!peerConnection.current) return;

    try {
      const stats = await peerConnection.current.getStats();
      const candidatePairStats: any[] = [];
      const localCandidateStats = new Map();
      const remoteCandidateStats = new Map();

      stats.forEach((report) => {
        if (report.type === 'candidate-pair') {
          candidatePairStats.push(report);
        } else if (report.type === 'local-candidate') {
          localCandidateStats.set(report.id, report);
        } else if (report.type === 'remote-candidate') {
          remoteCandidateStats.set(report.id, report);
        }
      });

      // Find all successful pairs, separating nominated from non-nominated
      const nominatedPairs = candidatePairStats.filter(pair => 
        pair.state === 'succeeded' && pair.nominated
      );
      const otherSuccessfulPairs = candidatePairStats.filter(pair => 
        pair.state === 'succeeded' && !pair.nominated
      );

      if (nominatedPairs.length > 0 || otherSuccessfulPairs.length > 0) {
        addMessage('🏆 SUCCESSFUL CONNECTION DETAILS:', 'ice-debug');
        
        // Show nominated pairs first (primary active connections)
        nominatedPairs.forEach((pair, index) => {
          const localCandidate = localCandidateStats.get(pair.localCandidateId);
          const remoteCandidate = remoteCandidateStats.get(pair.remoteCandidateId);
          
          if (localCandidate && remoteCandidate) {
            const localType = getCandidateTypeDescription(localCandidate.candidateType);
            const remoteType = getCandidateTypeDescription(remoteCandidate.candidateType);
            
            addMessage(`👑 PRIMARY #${index + 1}: ${localCandidate.candidateType.toUpperCase()} ↔ ${remoteCandidate.candidateType.toUpperCase()} [NOMINATED - ACTIVE PATH]`, 'ice-debug');
            addMessage(`   Local: ${localCandidate.address}:${localCandidate.port} (${localCandidate.protocol}) - ${localType}`, 'ice-debug');
            addMessage(`   Remote: ${remoteCandidate.address}:${remoteCandidate.port} (${remoteCandidate.protocol}) - ${remoteType}`, 'ice-debug');
            addMessage(`   Priority: ${pair.priority || 'N/A'} (HIGHEST PRIORITY - IN USE)`, 'ice-debug');
            
            if (pair.totalRoundTripTime && pair.requestsSent && pair.requestsSent > 0) {
              const avgRtt = (pair.totalRoundTripTime / pair.requestsSent * 1000).toFixed(2);
              addMessage(`   Average RTT: ${avgRtt}ms (ACTIVE CONNECTION)`, 'ice-debug');
            }
            
            if (pair.currentRoundTripTime) {
              const currentRtt = (pair.currentRoundTripTime * 1000).toFixed(2);
              addMessage(`   Current RTT: ${currentRtt}ms (LIVE DATA)`, 'ice-debug');
            }
            
            if (pair.availableOutgoingBitrate) {
              const bandwidth = Math.round(pair.availableOutgoingBitrate / 1000);
              addMessage(`   Available bandwidth: ~${bandwidth} kbps (CURRENT CAPACITY)`, 'ice-debug');
            }
            
            addMessage(`   ⚡ This is the path your data is actually using!`, 'ice-debug');
          }
        });
        
        // Show other successful pairs (backup connections)
        otherSuccessfulPairs.forEach((pair, index) => {
          const localCandidate = localCandidateStats.get(pair.localCandidateId);
          const remoteCandidate = remoteCandidateStats.get(pair.remoteCandidateId);
          
          if (localCandidate && remoteCandidate) {
            const localType = getCandidateTypeDescription(localCandidate.candidateType);
            const remoteType = getCandidateTypeDescription(remoteCandidate.candidateType);
            
            addMessage(`🔄 BACKUP #${index + 1}: ${localCandidate.candidateType.toUpperCase()} ↔ ${remoteCandidate.candidateType.toUpperCase()} [STANDBY PATH]`, 'ice-debug');
            addMessage(`   Local: ${localCandidate.address}:${localCandidate.port} (${localCandidate.protocol}) - ${localType}`, 'ice-debug');
            addMessage(`   Remote: ${remoteCandidate.address}:${remoteCandidate.port} (${remoteCandidate.protocol}) - ${remoteType}`, 'ice-debug');
            addMessage(`   Priority: ${pair.priority || 'N/A'} (READY IF NEEDED)`, 'ice-debug');
            
            if (pair.totalRoundTripTime && pair.requestsSent && pair.requestsSent > 0) {
              const avgRtt = (pair.totalRoundTripTime / pair.requestsSent * 1000).toFixed(2);
              addMessage(`   Average RTT: ${avgRtt}ms (BACKUP PERFORMANCE)`, 'ice-debug');
            }
            
            addMessage(`   💤 Ready to take over if primary path fails`, 'ice-debug');
          }
        });
      } else {
        // Fallback: look for any succeeded pairs (even if not nominated yet)
        const anySuccessful = candidatePairStats.filter(pair => pair.state === 'succeeded');
        if (anySuccessful.length > 0) {
          addMessage('🎉 Connection successful! (Nomination pending...)', 'ice-debug');
          anySuccessful.forEach((pair, index) => {
            addMessage(`   ⏳ Successful pair #${index + 1} with priority ${pair.priority} (AWAITING NOMINATION)`, 'ice-debug');
            if (pair.totalRoundTripTime && pair.requestsSent) {
              const avgRtt = (pair.totalRoundTripTime / pair.requestsSent * 1000).toFixed(2);
              addMessage(`   Round-trip time: ${avgRtt}ms`, 'ice-debug');
            }
          });
        }
      }
    } catch (error) {
      addMessage(`Error getting success stats: ${error}`, 'ice-debug');
    }
  };

  const setupDataChannel = (): void => {
    if (!dataChannel.current) return;

    dataChannel.current.onopen = (): void => {
      setDataChannelState('open');
      addMessage('🎉 Data channel opened - you can now send messages!', 'system');
    };

    dataChannel.current.onclose = (): void => {
      setDataChannelState('closed');
      addMessage('Data channel closed', 'system');
    };

    dataChannel.current.onerror = (error: Event): void => {
      addMessage(`Data channel error: ${error}`, 'error');
    };

    dataChannel.current.onmessage = (event: MessageEvent<string>): void => {
      addMessage(event.data, 'received');
    };
  };

  const createOffer = async (): Promise<void> => {
    try {
      if (!peerConnection.current) throw new Error('No peer connection available');
      
      addMessage('📝 Creating connection offer...', 'system');
      const offer = await peerConnection.current.createOffer();
      addMessage('⚙️ Setting up local connection details...', 'system');
      await peerConnection.current.setLocalDescription(offer);
      
      // Wait a moment for ICE gathering to start
      setTimeout(() => {
        if (peerConnection.current?.localDescription) {
          setLocalOffer(JSON.stringify(peerConnection.current.localDescription, null, 2));
          addMessage('✅ Offer ready! Copy this and send it to the other peer', 'system');
        }
      }, 1000);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addMessage(`Error creating offer: ${errorMessage}`, 'error');
    }
  };

  const handleRemoteOffer = async (): Promise<void> => {
    addMessage('📨 Processing connection offer from peer...', 'system');
    try {
      if (!peerConnection.current) {
        throw new Error('No peer connection available');
      }
      if (!remoteOffer.trim()) {
        throw new Error('No offer provided');
      }
      
      const offer: RTCSessionDescriptionInit = JSON.parse(remoteOffer);
      addMessage('⚙️ Understanding peer\'s connection details...', 'system');
      
      await peerConnection.current.setRemoteDescription(offer);
      addMessage('📝 Creating response (answer)...', 'system');
      
      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      
      // Wait for ICE gathering to include candidates
      setTimeout(() => {
        if (peerConnection.current?.localDescription) {
          setLocalAnswer(JSON.stringify(peerConnection.current.localDescription, null, 2));
          addMessage('✅ Answer ready! Copy this and send it back to the initiator', 'system');
        }
      }, 1000);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addMessage(`Error handling remote offer: ${errorMessage}`, 'error');
      console.error('Remote offer error:', error);
    }
  };

  const handleRemoteAnswer = async (): Promise<void> => {
    addMessage('📨 Processing answer from peer...', 'system');
    try {
      if (!peerConnection.current) {
        throw new Error('No peer connection available');
      }
      if (!remoteAnswer.trim()) {
        throw new Error('No answer provided');
      }
      
      const answer: RTCSessionDescriptionInit = JSON.parse(remoteAnswer);
      addMessage('⚙️ Applying peer\'s response...', 'system');
      
      await peerConnection.current.setRemoteDescription(answer);
      addMessage('✅ Handshake complete! Connection should establish now...', 'system');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addMessage(`Error handling remote answer: ${errorMessage}`, 'error');
      console.error('Remote answer error:', error);
    }
  };

  const sendMessage = (): void => {
    if (dataChannel.current && dataChannel.current.readyState === 'open' && message.trim()) {
      dataChannel.current.send(message);
      addMessage(message, 'sent');
      setMessage('');
    }
  };

  const addMessage = (text: string, type: Message['type']): void => {
    const timestamp = new Date().toLocaleTimeString();
    setMessages(prev => [...prev, { text, type, timestamp }]);
  };

  const copyToClipboard = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      addMessage('Copied to clipboard', 'system');
    } catch {
      addMessage('Failed to copy to clipboard', 'error');
    }
  };

  const reset = (): void => {
    if (peerConnection.current) {
      peerConnection.current.close();
    }
    if (dataChannel.current) {
      dataChannel.current.close();
    }
    
    // Clean up media stream
    cleanupMediaStream();
    
    peerConnection.current = null;
    dataChannel.current = null;
    localCandidates.current.clear();
    remoteCandidates.current.clear();
    candidatePairs.current.clear();
    setConnectionState('new');
    setIceState('new');
    setDataChannelState('closed');
    setLocalOffer('');
    setLocalAnswer('');
    setRemoteOffer('');
    setRemoteAnswer('');
    setMessages([]);
    setIsInitiator(false);
    setMediaPermissionState('none');
    addMessage('Reset connection', 'system');
  };

  const getStatusColor = (state: string): string => {
    switch (state) {
      case 'connected': 
      case 'open': 
        return 'text-green-600';
      case 'connecting': 
      case 'checking': 
        return 'text-yellow-600';
      case 'failed': 
      case 'disconnected': 
      case 'closed': 
        return 'text-red-600';
      default: 
        return 'text-gray-600';
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  // Sample ICE servers configuration for the textarea placeholder
  const sampleIceConfig = `[
  {
    "urls": "stun:stun.l.google.com:19302"
  },
  {
    "urls": "stun:stun1.l.google.com:19302"
  },
  {
    "urls": [
      "turn:your-turn-server.com:3478",
      "turns:your-turn-server.com:5349"
    ],
    "username": "your-username",
    "credential": "your-password"
  }
]`;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">WebRTC Debugger</h1>
        <p className="text-gray-600">Test peer-to-peer data sharing with detailed ICE connectivity logging</p>
      </div>

      {/* Status Panel */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Connection Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="flex items-center space-x-2">
            <Wifi className="w-5 h-5" />
            <span>Connection: <span className={getStatusColor(connectionState)}>{connectionState}</span></span>
          </div>
          <div className="flex items-center space-x-2">
            <WifiOff className="w-5 h-5" />
            <span>ICE: <span className={getStatusColor(iceState)}>{iceState}</span></span>
          </div>
          <div className="flex items-center space-x-2">
            <Send className="w-5 h-5" />
            <span>Data Channel: <span className={getStatusColor(dataChannelState)}>{dataChannelState}</span></span>
          </div>
          <div className="flex items-center space-x-2">
            {hasMediaStream ? (
              <span className="text-green-600">🎤 Media: Active</span>
            ) : mediaPermissionState === 'denied' ? (
              <span className="text-red-600">🚫 Media: Denied</span>
            ) : mediaPermissionState === 'requesting' ? (
              <span className="text-yellow-600">⏳ Media: Requesting</span>
            ) : (
              <span className="text-gray-600">🎤 Media: None</span>
            )}
          </div>
        </div>
      </div>

      {/* ICE Servers Configuration */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">ICE Servers Configuration</h2>
          <div className="flex items-center space-x-2">
            {usingCustomIceServers && (
              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">Custom</span>
            )}
            <button
              onClick={() => setShowCustomIceConfig(!showCustomIceConfig)}
              className="flex items-center space-x-1 px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm"
            >
              <Settings className="w-4 h-4" />
              <span>Configure</span>
            </button>
          </div>
        </div>

        {showCustomIceConfig && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg border">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Custom ICE Servers (JSON)</h3>
            <textarea
              value={customIceServersText}
              onChange={(e) => setCustomIceServersText(e.target.value)}
              placeholder={sampleIceConfig}
              className="w-full h-40 p-3 border border-gray-300 rounded text-xs font-mono resize-none"
            />
            {customIceServersError && (
              <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                {customIceServersError}
              </div>
            )}
            <div className="mt-3 flex items-center space-x-2">
              <button
                onClick={applyCustomIceServers}
                disabled={!customIceServersText.trim()}
                className="flex items-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm"
              >
                <Check className="w-4 h-4" />
                <span>Apply Custom Config</span>
              </button>
              <button
                onClick={resetToDefaultIceServers}
                className="flex items-center space-x-1 px-3 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
              >
                <X className="w-4 h-4" />
                <span>Reset to Default</span>
              </button>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              <p>• Enter ICE servers as a JSON array</p>
              <p>• Include STUN servers for NAT traversal</p>
              <p>• Include TURN servers with credentials for relay connections</p>
              <p>• Each server needs a "urls" property (string or array)</p>
            </div>
          </div>
        )}

        {iceServersLoading ? (
          <div className="text-center py-4">
            <div className="text-gray-500">Loading ICE servers...</div>
          </div>
        ) : (
          <div className="space-y-2">
            {iceServers.length > 0 ? (
              iceServers.map((server, index) => (
                <div key={index} className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                  <div className="font-mono">
                    {Array.isArray(server.urls) ? server.urls.join(', ') : server.urls}
                  </div>
                  {server.username && (
                    <div className="text-xs text-gray-400 mt-1">
                      Username: {server.username} (with credentials)
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-gray-500">No ICE servers available</div>
            )}
          </div>
        )}
      </div>

      {/* Connection Setup */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Setup Connection</h2>
        
        <div className="space-y-4">
          {/* Media Permission Section */}
          {mediaPermissionState === 'none' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-lg font-medium text-blue-900 mb-2">🎤 Improve Browser Compatibility</h3>
              <p className="text-blue-700 text-sm mb-3">
                Firefox and some other browsers work better with WebRTC data channels when microphone permission is granted. 
                The audio will be immediately muted - it{'\''}s only used to improve connection reliability.
              </p>
              <button
                onClick={requestMediaPermissions}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Grant Microphone Permission
              </button>
            </div>
          )}
          
          {mediaPermissionState === 'denied' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h3 className="text-lg font-medium text-yellow-900 mb-2">⚠️ Media Permission Denied</h3>
              <p className="text-yellow-700 text-sm">
                Data channels may still work, but connection reliability might be reduced in some browsers (especially Firefox).
              </p>
            </div>
          )}
          
          <div className="flex space-x-4">
            <button
              onClick={() => initializeWebRTC(true)}
              disabled={peerConnection.current !== null || iceServersLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
            >
              Initialize as Initiator
            </button>
            <button
              onClick={() => initializeWebRTC(false)}
              disabled={peerConnection.current !== null || iceServersLoading}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
            >
              Initialize as Receiver
            </button>
            <button
              onClick={reset}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center space-x-2"
            >
              <Trash2 className="w-4 h-4" />
              <span>Reset</span>
            </button>
          </div>

          {isInitiator && peerConnection.current && (
            <div className="space-y-4">
              <button
                onClick={createOffer}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
              >
                Create Offer
              </button>
              
              {localOffer && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Local Offer (send this to peer):
                  </label>
                  <div className="relative">
                    <textarea
                      value={localOffer}
                      readOnly
                      className="w-full h-32 p-3 border border-gray-300 rounded resize-none text-xs"
                    />
                    <button
                      onClick={() => copyToClipboard(localOffer)}
                      className="absolute top-2 right-2 p-1 text-gray-500 hover:text-gray-700"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Remote Answer (paste from peer):
                </label>
                <textarea
                  value={remoteAnswer}
                  onChange={(e) => setRemoteAnswer(e.target.value)}
                  className="w-full h-32 p-3 border border-gray-300 rounded resize-none text-xs"
                  placeholder="Paste the answer from the other peer here..."
                />
                <button
                  onClick={handleRemoteAnswer}
                  disabled={!remoteAnswer.trim()}
                  className="mt-2 px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:bg-gray-400"
                >
                  Process Answer
                </button>
              </div>
            </div>
          )}

          {!isInitiator && peerConnection.current && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Remote Offer (paste from initiator):
                </label>
                <textarea
                  value={remoteOffer}
                  onChange={(e) => setRemoteOffer(e.target.value)}
                  className="w-full h-32 p-3 border border-gray-300 rounded resize-none text-xs"
                  placeholder="Paste the offer from the initiator here..."
                />
                <button
                  onClick={handleRemoteOffer}
                  disabled={!remoteOffer.trim()}
                  className="mt-2 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400"
                >
                  Process Offer & Create Answer
                </button>
              </div>

              {localAnswer && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Local Answer (send this back to initiator):
                  </label>
                  <div className="relative">
                    <textarea
                      value={localAnswer}
                      readOnly
                      className="w-full h-32 p-3 border border-gray-300 rounded resize-none text-xs"
                    />
                    <button
                      onClick={() => copyToClipboard(localAnswer)}
                      className="absolute top-2 right-2 p-1 text-gray-500 hover:text-gray-700"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messaging */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Data Channel Messaging</h2>
        
        <div className="space-y-4">
          <div className="flex space-x-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              className="flex-1 p-2 border border-gray-300 rounded"
              disabled={dataChannelState !== 'open'}
            />
            <button
              onClick={sendMessage}
              disabled={dataChannelState !== 'open' || !message.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 flex items-center space-x-2"
            >
              <Send className="w-4 h-4" />
              <span>Send</span>
            </button>
          </div>

          <div className="h-96 border border-gray-300 rounded p-4 overflow-y-auto bg-gray-50">
            {messages.length === 0 ? (
              <p className="text-gray-500 text-center">No messages yet...</p>
            ) : (
              <div className="space-y-2">
                {messages.map((msg, index) => (
                  <div key={index} className={`text-sm ${
                    msg.type === 'sent' ? 'text-blue-600' :
                    msg.type === 'received' ? 'text-green-600' :
                    msg.type === 'error' ? 'text-red-600' :
                    msg.type === 'ice-debug' ? 'text-purple-600 font-mono' :
                    'text-gray-600'
                  }`}>
                    <span className="text-gray-400 text-xs">[{msg.timestamp}]</span>
                    <span className="ml-2">
                      {msg.type === 'sent' && '→ '}
                      {msg.type === 'received' && '← '}
                      {msg.type === 'system' && 'ℹ '}
                      {msg.type === 'error' && '⚠ '}
                      {msg.type === 'ice-debug' && '🔍 '}
                      {msg.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="text-center text-sm text-gray-500">
        <p>Open this page in two separate tabs or browsers to test peer-to-peer connection.</p>
        <p>One should be the initiator, the other the receiver. Copy/paste the offers and answers between them.</p>
        <p className="mt-2 text-purple-600 font-medium">Purple messages show detailed ICE connectivity debugging information.</p>
        <p className="mt-1 text-blue-600">💡 For best results in Firefox, grant microphone permission when prompted.</p>
        <p className="mt-1 text-green-600">🔧 Use the Configure button to test with custom STUN/TURN servers.</p>
      </div>
    </div>
  );
}