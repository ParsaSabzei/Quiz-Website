const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const server = http.createServer(app);

// Optimized Socket.IO configuration for 300 concurrent users
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Performance optimizations
    pingTimeout: 10000,
    pingInterval: 5000,
    upgradeTimeout: 10000,
    maxHttpBufferSize: 1e6, // 1MB
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    perMessageDeflate: {
        threshold: 1024
    }
});

// Security & Performance Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression()); // Gzip compression
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 1000, // 1 second
    max: 20, // max 20 requests per second per IP
    message: 'درخواست‌های زیادی ارسال شده است. لطفاً کمی صبر کنید.'
});
app.use('/api', limiter);

app.use(express.static(path.join(__dirname)));

// Performance monitoring (silent)
setInterval(() => {
    // Monitor server health silently
}, 30000);

// Game State
const gameState = {
    status: 'waiting', // waiting, playing, finished
    players: new Map(), // socketId -> player data
    playerSessions: new Map(), // sessionId -> player data (for reconnection)
    registeredStudentIds: new Set(), // Track all student IDs that have ever registered
    eliminatedStudentIds: new Set(), // Track eliminated student IDs to prevent rejoin
    currentQuestionIndex: 0,
    currentQuestionStartTime: null, // When the current question was sent
    currentQuestionTimeLimit: null, // Time limit for current question in seconds
    gameStartedAcks: new Set(), // Track who acknowledged game start
    currentQuestionAcks: new Set(), // Track who acknowledged current question
    questions: [
        {
            id: 1,
            text: "کدام جاندار در غذای سلف یافت نشده است؟",
            options: [
                "حلزون",
                "کرم",
                "دایناسور",
                "سوسک"
            ],
            correctAnswer: 2,
            timeLimit: 15
        },
        {
            id: 2,
            text: "کدام از یک اساتید زیر به دانشجویان کلاس شکلات جایزه می دهد؟",
            options: [
                "دکتر شمس اللهی",
                "دکتر سروری",
                "دکتر فخارزاده",
                "دکتر سروری"
            ],
            correctAnswer: 1,
            timeLimit: 15
        },
        {
            id: 3,
            text: "چند نفر از دانشجویان ورودی ۱۴۰۰ برق شریف تحصیلات کارشناسی خود را در هشت ترم تمام کردند؟",
            options: [
                "پنج تا ده نفر",
                "بیست تا بیست و پنج نفر",
                "چهل تا پنجاه نفر",
                "دکتر سروری"
            ],
            correctAnswer: 0,
            timeLimit: 15
        },
        {
            id: 4,
            text: "جریان مشخص شده چند آمپر است؟",
            options: [
                "1",
                "2",
                "3",
                "4"
            ],
            correctAnswer: 1,
            timeLimit: 15
        },
        {
            id: 5,
            text: "زمین چمن سابق دانشگاه در کدام موقعیت قرار داشت؟",
            options: [
                "دانشکده مکانیک(پردیس شمالی)",
                "دانشکده کامپیوتر",
                "دانشکده هوافضا(زمین چمن سابق)",
                "هیچ کدام"
            ],
            correctAnswer: 3,
            timeLimit: 15
        },
        {
            id: 6,
            text: "برق چند حرف دارد؟",
            options: [
                "یک حرف",
                "دو حرف",
                "سه حرف",
                "برق حرف نداره"
            ],
            correctAnswer: 3,
            timeLimit: 15
        }
    ],
    winners: [],
    eliminated: [],
    startTime: null,
    questionTimer: null
};

// Admin connections
const adminSockets = new Set();

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// API Endpoints
app.get('/api/game-status', (req, res) => {
    res.json({
        status: gameState.status,
        playerCount: gameState.players.size,
        currentQuestion: gameState.currentQuestionIndex,
        totalQuestions: gameState.questions.length
    });
});

app.get('/api/players', (req, res) => {
    const players = Array.from(gameState.players.values()).map(p => ({
        firstName: p.firstName,
        lastName: p.lastName,
        studentId: p.studentId,
        status: p.status,
        correctAnswers: p.correctAnswers
    }));
    res.json(players);
});

app.get('/api/winners', (req, res) => {
    res.json(gameState.winners);
});

// Socket.IO Connection
io.on('connection', (socket) => {
    // Admin Connection
    socket.on('admin-connect', () => {
        adminSockets.add(socket.id);
        
        console.log('Admin connected, sending lightweight game state...');
        
        // Send LIGHTWEIGHT game state to admin
        socket.emit('game-state-update', {
            status: gameState.status,
            playerCount: gameState.players.size,
            currentQuestion: gameState.currentQuestionIndex,
            totalQuestions: gameState.questions.length,
            players: getPlayersForAdmin(), // Optimized function
            winners: gameState.winners.map(w => ({
                firstName: w.firstName,
                lastName: w.lastName,
                studentId: w.studentId,
                correctAnswers: w.correctAnswers
            }))
        });
        
        console.log('✅ Admin state sent successfully');
    });

    // Player Registration
    socket.on('player-register', (data) => {
        const { sessionId, firstName, lastName, studentId } = data;
        
        // Check if game has already started
        if (gameState.status === 'playing' || gameState.status === 'finished') {
            socket.emit('registration-failed', {
                message: 'مسابقه قبلاً شروع شده است. امکان ورود جدید وجود ندارد',
                reason: 'game-started'
            });
            return;
        }
        
        // Check if student ID has already been registered (but not by this session)
        if (gameState.registeredStudentIds.has(studentId)) {
            // Check if this is a reconnection attempt with valid session
            const existingSession = gameState.playerSessions.get(sessionId);
            if (!existingSession || existingSession.studentId !== studentId) {
                socket.emit('registration-failed', {
                    message: 'این شماره دانشجویی قبلاً ثبت نام کرده است',
                    reason: 'duplicate-id'
                });
                return;
            }
        }
        
        // Check if student has been eliminated and trying to rejoin
        if (gameState.eliminatedStudentIds.has(studentId)) {
            socket.emit('registration-failed', {
                message: 'شما از مسابقه حذف شده‌اید و امکان بازگشت وجود ندارد',
                reason: 'eliminated'
            });
            return;
        }
        
        const player = {
            sessionId,
            socketId: socket.id,
            firstName,
            lastName,
            studentId,
            status: 'waiting', // waiting, playing, eliminated, winner
            correctAnswers: 0,
            hasAnswered: false,
            joinedAt: new Date()
        };
        
        // Join the active-players room for efficient broadcasting
        socket.join('active-players');
        
        gameState.players.set(socket.id, player);
        gameState.playerSessions.set(sessionId, player);
        gameState.registeredStudentIds.add(studentId);
        
        // Notify player
        socket.emit('registration-success', {
            sessionId: sessionId,
            status: player.status,
            message: 'ثبت نام موفقیت‌آمیز بود',
            gameStatus: gameState.status
        });
        
        // Update all admins
        broadcastToAdmins('player-joined', {
            player: {
                socketId: player.socketId,
                firstName: player.firstName,
                lastName: player.lastName,
                studentId: player.studentId,
                status: player.status,
                correctAnswers: player.correctAnswers
            },
            totalPlayers: gameState.players.size
        });
    });

    // Player Reconnection
    socket.on('player-reconnect', (data) => {
        const { sessionId, studentId, firstName, lastName } = data;
        
        // Check if session exists
        const sessionPlayer = gameState.playerSessions.get(sessionId);
        
        if (!sessionPlayer) {
            socket.emit('reconnect-failed', {
                message: 'جلسه معتبر نیست. لطفاً دوباره ثبت‌نام کنید',
                reason: 'invalid-session'
            });
            return;
        }
        
        // Verify student ID matches
        if (sessionPlayer.studentId !== studentId) {
            socket.emit('reconnect-failed', {
                message: 'اطلاعات جلسه با شماره دانشجویی مطابقت ندارد',
                reason: 'session-mismatch'
            });
            return;
        }
        
        // Update socket ID
        const oldSocketId = sessionPlayer.socketId;
        sessionPlayer.socketId = socket.id;
        
        // Remove old socket reference and add new one
        if (gameState.players.has(oldSocketId)) {
            gameState.players.delete(oldSocketId);
        }
        gameState.players.set(socket.id, sessionPlayer);
        
        // Rejoin the active-players room (only if not eliminated)
        if (sessionPlayer.status !== 'eliminated') {
            socket.join('active-players');
        }
        
        // Prepare reconnection response
        const response = {
            status: sessionPlayer.status,
            correctAnswers: sessionPlayer.correctAnswers,
            message: 'اتصال مجدد موفقیت‌آمیز بود'
        };
        
        // If game is playing, send current question with remaining time
        if (gameState.status === 'playing' && sessionPlayer.status === 'playing') {
            const question = gameState.questions[gameState.currentQuestionIndex];
            if (question && gameState.currentQuestionStartTime) {
                // Calculate time remaining
                const now = Date.now();
                const elapsed = Math.floor((now - gameState.currentQuestionStartTime) / 1000);
                const timeRemaining = Math.max(0, (gameState.currentQuestionTimeLimit || question.timeLimit) - elapsed);
                
                response.currentQuestion = {
                    id: question.id,
                    text: question.text,
                    options: question.options,
                    timeLimit: question.timeLimit,
                    timeRemaining: timeRemaining // Time left in seconds
                };
                response.questionNumber = gameState.currentQuestionIndex + 1;
                response.totalQuestions = gameState.questions.length;
            }
        }
        
        socket.emit('reconnect-success', response);
        
        // Update admins
        broadcastToAdmins('player-reconnected', {
            player: {
                firstName: sessionPlayer.firstName,
                lastName: sessionPlayer.lastName,
                studentId: sessionPlayer.studentId,
                status: sessionPlayer.status
            }
        });
    });

    // Admin Start Game
    socket.on('admin-start-game', () => {
        if (!adminSockets.has(socket.id)) {
            socket.emit('error', { message: 'Unauthorized' });
            return;
        }

        if (gameState.status === 'playing') {
            socket.emit('error', { message: 'بازی در حال انجام است' });
            return;
        }
        
        gameState.status = 'playing';
        gameState.currentQuestionIndex = 0;
        gameState.winners = [];
        gameState.eliminated = [];
        gameState.startTime = new Date();
        gameState.gameStartedAcks.clear(); // Clear previous ACKs
        
        // Update all players to playing status
        gameState.players.forEach(player => {
            player.status = 'playing';
            player.correctAnswers = 0;
            player.hasAnswered = false;
        });
        
        // Update all player sessions to playing status
        gameState.playerSessions.forEach(player => {
            player.status = 'playing';
            player.correctAnswers = 0;
            player.hasAnswered = false;
        });
        
        const totalPlayers = gameState.players.size;
        
        // CRITICAL FIX: Send to each player individually to ensure delivery
        let sentCount = 0;
        gameState.players.forEach(player => {
            io.to(player.socketId).emit('game-started', {
                message: 'بازی شروع شد!',
                totalQuestions: gameState.questions.length
            });
            sentCount++;
        });
        
        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(`║  🎮 GAME STARTED                                          ║`);
        console.log(`╠════════════════════════════════════════════════════════════╣`);
        console.log(`║  ✅ Sent to: ${sentCount} players                              `);
        console.log(`║  ⏳ Waiting for acknowledgments...                        ║`);
        console.log(`╚════════════════════════════════════════════════════════════╝\n`);
        
        // Send tracking info to admins
        broadcastToAdmins('game-start-sent', {
            totalPlayers: totalPlayers,
            sentCount: sentCount,
            ackedCount: 0
        });
        
        // Check ACKs after 3 seconds and send first question
        setTimeout(() => {
            const ackedCount = gameState.gameStartedAcks.size;
            const missingCount = totalPlayers - ackedCount;
            
            console.log(`\n╔════════════════════════════════════════════════════════════╗`);
            console.log(`║  📊 GAME START ACKNOWLEDGMENT REPORT                      ║`);
            console.log(`╠════════════════════════════════════════════════════════════╣`);
            console.log(`║  ✅ Acknowledged: ${ackedCount}/${totalPlayers}                         `);
            if (missingCount > 0) {
                console.log(`║  ⚠️  Missing ACKs: ${missingCount} players                           `);
            }
            console.log(`╚════════════════════════════════════════════════════════════╝\n`);
            
            // Update admins with final ACK count
            broadcastToAdmins('game-start-ack-report', {
                totalPlayers: totalPlayers,
                ackedCount: ackedCount,
                missingCount: missingCount
            });
            
            // Send first question
            sendQuestion();
        }, 3000); // Wait 3 seconds for ACKs
        
        // Update admins
        broadcastToAdmins('game-started', {
            status: gameState.status,
            playerCount: gameState.players.size
        });
    });

    // Player Answer (allow changes until timer ends)
    socket.on('player-answer', (data) => {
        const { questionId, answerIndex, timeRemaining } = data;
        const player = gameState.players.get(socket.id);
        
        if (!player || player.status !== 'playing') {
            return;
        }
        
        const question = gameState.questions[gameState.currentQuestionIndex];
        
        if (!question || question.id !== questionId) {
            return;
        }
        const isCorrect = answerIndex === question.correctAnswer;
        
        // Store/overwrite current answer (no immediate reveal)
        player.currentAnswer = answerIndex;
        player.isCurrentAnswerCorrect = isCorrect;
        
        // Acknowledge that answer was received (but don't reveal if correct or not)
        socket.emit('answer-submitted', {
            message: 'پاسخ شما ثبت شد'
        });
        
        // Update admins
        broadcastToAdmins('player-answered', {
            player: {
                firstName: player.firstName,
                lastName: player.lastName,
                studentId: player.studentId
            },
            answeredCount: Array.from(gameState.players.values()).filter(p => p.status === 'playing' && p.currentAnswer !== undefined && p.currentAnswer !== null).length,
            totalPlayers: Array.from(gameState.players.values()).filter(p => p.status === 'playing').length
        });
    });

    // Player Timeout event removed - no automatic timeout anymore

    // Admin Next Question
    socket.on('admin-next-question', () => {
        if (!adminSockets.has(socket.id)) {
            socket.emit('error', { message: 'Unauthorized' });
            return;
        }
        
        moveToNextQuestion();
    });

    // Admin Reset Game
    socket.on('admin-reset-game', () => {
        if (!adminSockets.has(socket.id)) {
            socket.emit('error', { message: 'Unauthorized' });
            return;
        }
        
        resetGame();
        
        // Broadcast to all connected sockets
        io.emit('game-reset', {
            message: 'بازی ریست شد'
        });
        
        // Send updated game state to all admins (lightweight)
        broadcastToAdmins('game-state-update', {
            status: gameState.status,
            playerCount: gameState.players.size,
            currentQuestion: gameState.currentQuestionIndex,
            totalQuestions: gameState.questions.length,
            players: getPlayersForAdmin(),
            winners: gameState.winners.map(w => ({
                firstName: w.firstName,
                lastName: w.lastName,
                studentId: w.studentId,
                correctAnswers: w.correctAnswers
            }))
        });
    });

    // CRITICAL: Handle game status check for polling
    socket.on('check-game-status', (data) => {
        const { sessionId } = data;
        const player = gameState.players.get(socket.id);
        
        if (!player) {
            // Player might be disconnected, check session
            const sessionPlayer = gameState.playerSessions.get(sessionId);
            if (sessionPlayer) {
                // Update socket ID
                sessionPlayer.socketId = socket.id;
                gameState.players.set(socket.id, sessionPlayer);
            } else {
                return;
            }
        }
        
        // Send current game status
        const response = {
            gameStatus: gameState.status,
            totalQuestions: gameState.questions.length
        };
        
        // If game is playing, include current question
        if (gameState.status === 'playing') {
            const question = gameState.questions[gameState.currentQuestionIndex];
            if (question) {
                response.currentQuestion = {
                    id: question.id,
                    text: question.text,
                    options: question.options,
                    timeLimit: null
                };
                response.currentQuestionNumber = gameState.currentQuestionIndex + 1;
            }
        }
        
        socket.emit('game-status-response', response);
    });

    // Handle game-started acknowledgment
    socket.on('game-started-ack', (data) => {
        const player = gameState.players.get(socket.id);
        if (player && gameState.status === 'playing') {
            if (!gameState.gameStartedAcks.has(player.studentId)) {
                gameState.gameStartedAcks.add(player.studentId);
                console.log(`✅ [${gameState.gameStartedAcks.size}/${gameState.players.size}] ${player.firstName} ${player.lastName} confirmed game start`);
                
                // Update admins in real-time
                broadcastToAdmins('game-start-ack-update', {
                    ackedCount: gameState.gameStartedAcks.size,
                    totalPlayers: gameState.players.size,
                    playerName: `${player.firstName} ${player.lastName}`
                });
            }
        }
    });
    
    // Handle new-question acknowledgment
    socket.on('question-received-ack', (data) => {
        const { questionId } = data;
        const player = gameState.players.get(socket.id);
        
        if (player && player.status === 'playing') {
            const currentQuestion = gameState.questions[gameState.currentQuestionIndex];
            if (currentQuestion && currentQuestion.id === questionId) {
                if (!gameState.currentQuestionAcks.has(player.studentId)) {
                    gameState.currentQuestionAcks.add(player.studentId);
                    
                    const activePlayers = Array.from(gameState.players.values()).filter(p => p.status === 'playing');
                    console.log(`✅ [${gameState.currentQuestionAcks.size}/${activePlayers.length}] ${player.firstName} ${player.lastName} received Q${gameState.currentQuestionIndex + 1}`);
                    
                    // Update admins in real-time
                    broadcastToAdmins('question-ack-update', {
                        questionNumber: gameState.currentQuestionIndex + 1,
                        ackedCount: gameState.currentQuestionAcks.size,
                        totalActivePlayers: activePlayers.length,
                        playerName: `${player.firstName} ${player.lastName}`
                    });
                }
            }
        }
    });

    // Disconnect
    socket.on('disconnect', (reason) => {
        // Leave all rooms
        socket.leave('active-players');
        
        // Remove from admin list
        adminSockets.delete(socket.id);
        
        // Handle player disconnect
        const player = gameState.players.get(socket.id);
        if (player) {
            // Don't remove player from game state immediately
            // Keep them in playerSessions so they can reconnect
            // Only remove from active players map
            gameState.players.delete(socket.id);
            
            // Update admins
            broadcastToAdmins('player-disconnected', {
                player: {
                    firstName: player.firstName,
                    lastName: player.lastName,
                    studentId: player.studentId,
                    status: player.status
                },
                totalPlayers: gameState.players.size
            });
        }
    });
});

// Helper Functions
function getPlayersForAdmin() {
    // OPTIMIZED: Only send essential data, no deep copying
    const allPlayersMap = new Map();
    
    // Add active players
    gameState.players.forEach((player) => {
        allPlayersMap.set(player.studentId, {
            firstName: player.firstName,
            lastName: player.lastName,
            studentId: player.studentId,
            status: player.status,
            correctAnswers: player.correctAnswers || 0
        });
    });
    
    // Add players from sessions (in case they're disconnected)
    gameState.playerSessions.forEach((player) => {
        if (!allPlayersMap.has(player.studentId)) {
            allPlayersMap.set(player.studentId, {
                firstName: player.firstName,
                lastName: player.lastName,
                studentId: player.studentId,
                status: player.status,
                correctAnswers: player.correctAnswers || 0
            });
        }
    });
    
    // Convert to array and sort by correctAnswers (descending)
    const allPlayers = Array.from(allPlayersMap.values())
        .sort((a, b) => b.correctAnswers - a.correctAnswers)
        .slice(0, 30); // Top 30 for now
    
    return allPlayers;
}

function checkIfAllPlayersAnswered() {
    // With synchronized reveal at timeout, we only log progress here.
    const activePlayers = Array.from(gameState.players.values()).filter(p => p.status === 'playing');
    const answeredPlayers = activePlayers.filter(p => p.currentAnswer !== undefined && p.currentAnswer !== null);
}

function revealQuestionResults() {
    const question = gameState.questions[gameState.currentQuestionIndex];
    if (!question) return;
    
    const activePlayers = Array.from(gameState.players.values()).filter(p => p.status === 'playing');
    
    activePlayers.forEach(player => {
        const hasAnswer = player.currentAnswer !== undefined && player.currentAnswer !== null && player.currentAnswer !== -1;
        const isCorrect = !!player.isCurrentAnswerCorrect && hasAnswer;
        
        if (isCorrect) {
            // Player answered correctly
            player.correctAnswers++;
            
            io.to(player.socketId).emit('answer-result', {
                correct: true,
                correctAnswer: question.correctAnswer,
                yourAnswer: player.currentAnswer
            });
            
            // REAL-TIME UPDATE: Notify admins about score increase
            broadcastToAdmins('player-score-updated', {
                studentId: player.studentId,
                firstName: player.firstName,
                lastName: player.lastName,
                correctAnswers: player.correctAnswers,
                status: player.status
            });
        } else {
            // Player answered incorrectly or didn't answer - eliminate
            player.status = 'eliminated';
            gameState.eliminatedStudentIds.add(player.studentId);
            
            const eliminationReason = player.currentAnswer === -1 ? 'timeout' : 'wrong_answer';
            
            gameState.eliminated.push({
                firstName: player.firstName,
                lastName: player.lastName,
                studentId: player.studentId,
                correctAnswers: player.correctAnswers,
                eliminatedAt: new Date(),
                eliminatedAtQuestion: gameState.currentQuestionIndex + 1,
                reason: eliminationReason
            });
            
            // Remove player from active-players room so they don't receive future questions
            const playerSocket = io.sockets.sockets.get(player.socketId);
            if (playerSocket) {
                playerSocket.leave('active-players');
            }
            
            io.to(player.socketId).emit('answer-result', {
                correct: false,
                correctAnswer: question.correctAnswer,
                yourAnswer: player.currentAnswer,
                eliminated: true
            });
            
            io.to(player.socketId).emit('player-eliminated', {
                correctAnswers: player.correctAnswers,
                totalQuestions: gameState.questions.length,
                reason: eliminationReason
            });
            
            // REAL-TIME UPDATE: Update admins about elimination
            broadcastToAdmins('player-eliminated', {
                player: {
                    firstName: player.firstName,
                    lastName: player.lastName,
                    studentId: player.studentId,
                    correctAnswers: player.correctAnswers,
                    eliminatedAtQuestion: gameState.currentQuestionIndex + 1,
                    status: 'eliminated'
                },
                reason: eliminationReason,
                remainingPlayers: Array.from(gameState.players.values()).filter(p => p.status === 'playing').length
            });
        }
        
        // Reset for next question
        player.currentAnswer = null;
        player.isCurrentAnswerCorrect = null;
    });
}

function sendQuestion() {
    if (gameState.currentQuestionIndex >= gameState.questions.length) {
        endGame();
        return;
    }
    
    const question = gameState.questions[gameState.currentQuestionIndex];
    
    // Get active players
    const activePlayers = Array.from(gameState.players.values()).filter(p => p.status === 'playing');
    
    if (activePlayers.length === 0) {
        endGame();
        return;
    }
    
    // Record when this question was sent
    gameState.currentQuestionStartTime = Date.now();
    gameState.currentQuestionTimeLimit = question.timeLimit;
    gameState.currentQuestionAcks.clear(); // Clear previous question ACKs
    
    // Clear any existing per-player temp state
    gameState.players.forEach(p => {
        if (p.status === 'playing') {
            p.currentAnswer = null;
            p.isCurrentAnswerCorrect = null;
        }
    });

    // CRITICAL FIX: Send to each active player individually to ensure delivery
    let sentCount = 0;
    activePlayers.forEach(player => {
        io.to(player.socketId).emit('new-question', {
            questionNumber: gameState.currentQuestionIndex + 1,
            totalQuestions: gameState.questions.length,
            question: {
                id: question.id,
                text: question.text,
                options: question.options,
                timeLimit: null // No time limit - admin controlled
            }
        });
        sentCount++;
    });
    
    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
    console.log(`║  ❓ QUESTION ${gameState.currentQuestionIndex + 1}/${gameState.questions.length} SENT                                   ║`);
    console.log(`╠════════════════════════════════════════════════════════════╣`);
    console.log(`║  ✅ Sent to: ${sentCount} active players                       `);
    console.log(`║  ⏳ Waiting for acknowledgments...                        ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝\n`);
    
    // Send tracking info to admins
    broadcastToAdmins('question-sent', {
        questionNumber: gameState.currentQuestionIndex + 1,
        totalQuestions: gameState.questions.length,
        activePlayers: activePlayers.length,
        sentCount: sentCount,
        ackedCount: 0
    });
    
    // Check ACKs after 5 seconds and report
    setTimeout(() => {
        const ackedCount = gameState.currentQuestionAcks.size;
        const missingCount = activePlayers.length - ackedCount;
        
        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(`║  📊 QUESTION ${gameState.currentQuestionIndex + 1} ACKNOWLEDGMENT REPORT                   ║`);
        console.log(`╠════════════════════════════════════════════════════════════╣`);
        console.log(`║  ✅ Acknowledged: ${ackedCount}/${activePlayers.length}                            `);
        if (missingCount > 0) {
            console.log(`║  ⚠️  Missing ACKs: ${missingCount} players                           `);
            
            // List players who didn't ACK
            const ackedIds = gameState.currentQuestionAcks;
            const missingPlayers = activePlayers.filter(p => !ackedIds.has(p.studentId));
            console.log(`║  Missing players:                                         ║`);
            missingPlayers.forEach(p => {
                console.log(`║    - ${p.firstName} ${p.lastName} (${p.studentId})                `);
            });
        }
        console.log(`╚════════════════════════════════════════════════════════════╝\n`);
        
        // Update admins with final ACK report
        broadcastToAdmins('question-ack-report', {
            questionNumber: gameState.currentQuestionIndex + 1,
            totalActivePlayers: activePlayers.length,
            ackedCount: ackedCount,
            missingCount: missingCount
        });
    }, 5000); // Wait 5 seconds for ACKs
}

function moveToNextQuestion() {
    // Clear any running timer before moving on
    if (gameState.questionTimer) {
        clearTimeout(gameState.questionTimer);
        gameState.questionTimer = null;
    }
    
    // First, reveal results of current question
    revealQuestionResults();
    
    // Then move to next question
    gameState.currentQuestionIndex++;
    
    if (gameState.currentQuestionIndex >= gameState.questions.length) {
        endGame();
        return;
    }
    
    // Wait a bit before sending next question (to show results)
    setTimeout(() => {
        sendQuestion();
    }, 2000); // Give players 2 seconds to see the results
}

function endGame() {
    gameState.status = 'finished';
    if (gameState.questionTimer) {
        clearTimeout(gameState.questionTimer);
        gameState.questionTimer = null;
    }
    
    // Find winners (players who answered all questions correctly)
    gameState.winners = Array.from(gameState.players.values())
        .filter(p => p.status === 'playing' && p.correctAnswers === gameState.questions.length)
        .map(p => ({
            firstName: p.firstName,
            lastName: p.lastName,
            studentId: p.studentId,
            correctAnswers: p.correctAnswers,
            finishedAt: new Date()
        }));
    
    // Notify winners
    gameState.winners.forEach(winner => {
        const player = Array.from(gameState.players.values())
            .find(p => p.studentId === winner.studentId);
        
        if (player) {
            io.to(player.socketId).emit('game-won', {
                message: 'تبریک! شما برنده شدید',
                correctAnswers: player.correctAnswers,
                totalQuestions: gameState.questions.length
            });
        }
    });
    
    // Notify admins
    broadcastToAdmins('game-ended', {
        winners: gameState.winners,
        eliminated: [], // Don't send eliminated list
        totalPlayers: gameState.players.size
    });
    
    // Notify all players using room broadcast (OPTIMIZED)
    io.to('active-players').emit('game-finished', {
        message: 'بازی به پایان رسید',
        winnersCount: gameState.winners.length
    });
}

function resetGame() {
    gameState.status = 'waiting';
    
    // Reset all players to waiting status and rejoin active-players room
    gameState.players.forEach(player => {
        player.status = 'waiting';
        player.correctAnswers = 0;
        player.hasAnswered = false;
        player.currentAnswer = null;
        player.isCurrentAnswerCorrect = null;
        
        // Rejoin active-players room (in case they were eliminated and removed)
        const playerSocket = io.sockets.sockets.get(player.socketId);
        if (playerSocket) {
            playerSocket.join('active-players');
        }
    });
    
    // Reset all player sessions to waiting status
    gameState.playerSessions.forEach(player => {
        player.status = 'waiting';
        player.correctAnswers = 0;
        player.hasAnswered = false;
        player.currentAnswer = null;
        player.isCurrentAnswerCorrect = null;
    });
    
    // Clear eliminated IDs to allow them to play again
    gameState.eliminatedStudentIds.clear();
    
    // Clear ACK tracking
    gameState.gameStartedAcks.clear();
    gameState.currentQuestionAcks.clear();
    
    gameState.currentQuestionIndex = 0;
    gameState.currentQuestionStartTime = null;
    gameState.currentQuestionTimeLimit = null;
    gameState.winners = [];
    gameState.eliminated = [];
    gameState.startTime = null;
    
    if (gameState.questionTimer) {
        clearTimeout(gameState.questionTimer);
        gameState.questionTimer = null;
    }
    
    console.log('\n🔄 Game has been reset. All players returned to waiting room.\n');
}

function broadcastToAdmins(event, data) {
    adminSockets.forEach(adminId => {
        io.to(adminId).emit(event, data);
    });
}

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║   ⚡ سرور مسابقه دانشکده برق راه‌اندازی شد ⚡    ║
╠═══════════════════════════════════════════════════╣
║                                                   ║
║   🌐 آدرس بازیکنان:                              ║
║      http://localhost:${PORT}                        ║
║                                                   ║
║   👨‍💼 پنل ادمین:                                   ║
║      http://localhost:${PORT}/admin                  ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);
});

