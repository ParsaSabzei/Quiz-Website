const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Game State
const gameState = {
    status: 'waiting', // waiting, playing, finished
    players: new Map(), // socketId -> player data
    currentQuestionIndex: 0,
    questions: [
        {
            id: 1,
            text: "در یک مدار سری RLC، چه زمانی رزونانس اتفاق می‌افتد؟",
            options: [
                "زمانی که امپدانس خازن و سلف برابر باشند",
                "زمانی که ولتاژ و جریان هم فاز باشند",
                "زمانی که فرکانس صفر باشد",
                "زمانی که مقاومت به حداکثر برسد"
            ],
            correctAnswer: 1,
            timeLimit: 15
        },
        {
            id: 2,
            text: "قانون اهم بیان می‌کند که:",
            options: [
                "V = I × R",
                "P = V × I",
                "E = mc²",
                "F = ma"
            ],
            correctAnswer: 0,
            timeLimit: 15
        },
        {
            id: 3,
            text: "واحد اندازه‌گیری توان الکتریکی چیست؟",
            options: [
                "آمپر",
                "ولت",
                "وات",
                "اهم"
            ],
            correctAnswer: 2,
            timeLimit: 15
        },
        {
            id: 4,
            text: "در یک ترانسفورماتور ایده‌آل، نسبت ولتاژ ثانویه به اولیه برابر است با:",
            options: [
                "نسبت تعداد حلقه‌های اولیه به ثانویه",
                "نسبت تعداد حلقه‌های ثانویه به اولیه",
                "نسبت جریان اولیه به ثانویه",
                "نسبت توان اولیه به ثانویه"
            ],
            correctAnswer: 1,
            timeLimit: 15
        },
        {
            id: 5,
            text: "مفهوم امپدانس در مدارهای AC چیست؟",
            options: [
                "فقط مقاومت اهمی",
                "فقط راکتانس",
                "مجموع برداری مقاومت و راکتانس",
                "حاصل‌ضرب مقاومت در راکتانس"
            ],
            correctAnswer: 2,
            timeLimit: 15
        },
        {
            id: 6,
            text: "در یک دیود، جهت جریان مستقیم از کدام سمت به کدام سمت است؟",
            options: [
                "از آند به کاتد",
                "از کاتد به آند",
                "هر دو جهت",
                "هیچکدام"
            ],
            correctAnswer: 0,
            timeLimit: 15
        },
        {
            id: 7,
            text: "قانون کیرشهف ولتاژ بیان می‌کند که:",
            options: [
                "جمع جریان‌های ورودی و خروجی یک گره برابر صفر است",
                "جمع افت ولتاژها در یک حلقه بسته برابر صفر است",
                "ولتاژ در مدار سری برابر است",
                "جریان در مدار موازی برابر است"
            ],
            correctAnswer: 1,
            timeLimit: 15
        },
        {
            id: 8,
            text: "فرکانس برق شهری در ایران چند هرتز است؟",
            options: [
                "50 Hz",
                "60 Hz",
                "100 Hz",
                "120 Hz"
            ],
            correctAnswer: 0,
            timeLimit: 15
        },
        {
            id: 9,
            text: "در یک خازن، رابطه بین جریان و ولتاژ چگونه است؟",
            options: [
                "جریان از ولتاژ 90 درجه عقب‌تر است",
                "جریان از ولتاژ 90 درجه جلوتر است",
                "جریان و ولتاژ هم‌فاز هستند",
                "جریان از ولتاژ 180 درجه عقب‌تر است"
            ],
            correctAnswer: 1,
            timeLimit: 15
        },
        {
            id: 10,
            text: "مفهوم ضریب قدرت (Power Factor) چیست؟",
            options: [
                "نسبت توان اکتیو به توان راکتیو",
                "نسبت توان ظاهری به توان اکتیو",
                "نسبت توان اکتیو به توان ظاهری",
                "نسبت ولتاژ به جریان"
            ],
            correctAnswer: 2,
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
    console.log(`New connection: ${socket.id}`);

    // Admin Connection
    socket.on('admin-connect', () => {
        console.log(`Admin connected: ${socket.id}`);
        adminSockets.add(socket.id);
        
        // Send current game state to admin
        socket.emit('game-state-update', {
            status: gameState.status,
            playerCount: gameState.players.size,
            currentQuestion: gameState.currentQuestionIndex,
            totalQuestions: gameState.questions.length,
            players: Array.from(gameState.players.values()).map(p => ({
                socketId: p.socketId,
                firstName: p.firstName,
                lastName: p.lastName,
                studentId: p.studentId,
                status: p.status,
                correctAnswers: p.correctAnswers
            })),
            winners: gameState.winners,
            eliminated: gameState.eliminated
        });
    });

    // Player Registration
    socket.on('player-register', (data) => {
        const { firstName, lastName, studentId } = data;
        
        console.log(`Player registered: ${firstName} ${lastName} (${studentId})`);
        
        const player = {
            socketId: socket.id,
            firstName,
            lastName,
            studentId,
            status: 'waiting', // waiting, playing, eliminated, winner
            correctAnswers: 0,
            hasAnswered: false,
            joinedAt: new Date()
        };
        
        gameState.players.set(socket.id, player);
        
        // Notify player
        socket.emit('registration-success', {
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

        console.log('Admin started the game');
        
        gameState.status = 'playing';
        gameState.currentQuestionIndex = 0;
        gameState.winners = [];
        gameState.eliminated = [];
        gameState.startTime = new Date();
        
        // Update all players to playing status
        gameState.players.forEach(player => {
            player.status = 'playing';
            player.correctAnswers = 0;
            player.hasAnswered = false;
        });
        
        // Notify all players to start
        io.emit('game-started', {
            message: 'بازی شروع شد!',
            totalQuestions: gameState.questions.length
        });
        
        // Send first question after a short delay
        setTimeout(() => {
            sendQuestion();
        }, 2000);
        
        // Update admins
        broadcastToAdmins('game-started', {
            status: gameState.status,
            playerCount: gameState.players.size
        });
    });

    // Player Answer
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
        
        console.log(`Player ${player.firstName} answered question ${questionId}: ${isCorrect ? 'Correct' : 'Wrong'}`);
        
        if (isCorrect) {
            player.correctAnswers++;
            player.hasAnswered = true;
            
            // Notify player
            socket.emit('answer-result', {
                correct: true,
                correctAnswer: question.correctAnswer
            });
            
            // Check if all active players have answered
            checkIfAllPlayersAnswered();
        } else {
            // Player eliminated
            player.status = 'eliminated';
            player.hasAnswered = true;
            gameState.eliminated.push({
                firstName: player.firstName,
                lastName: player.lastName,
                studentId: player.studentId,
                correctAnswers: player.correctAnswers,
                eliminatedAt: new Date(),
                eliminatedAtQuestion: gameState.currentQuestionIndex + 1
            });
            
            // Notify player
            socket.emit('answer-result', {
                correct: false,
                correctAnswer: question.correctAnswer,
                eliminated: true
            });
            
            socket.emit('player-eliminated', {
                correctAnswers: player.correctAnswers,
                totalQuestions: gameState.questions.length
            });
            
            // Update admins
            broadcastToAdmins('player-eliminated', {
                player: {
                    firstName: player.firstName,
                    lastName: player.lastName,
                    studentId: player.studentId,
                    correctAnswers: player.correctAnswers,
                    eliminatedAtQuestion: gameState.currentQuestionIndex + 1
                },
                remainingPlayers: Array.from(gameState.players.values()).filter(p => p.status === 'playing').length
            });
            
            // Check if all active players have answered
            checkIfAllPlayersAnswered();
        }
    });

    // Player Timeout
    socket.on('player-timeout', (data) => {
        const { questionId } = data;
        const player = gameState.players.get(socket.id);
        
        if (!player || player.status !== 'playing') {
            return;
        }
        
        if (player.hasAnswered) {
            return; // Player already answered
        }
        
        console.log(`Player ${player.firstName} timed out on question ${questionId}`);
        
        // Player eliminated due to timeout
        player.status = 'eliminated';
        player.hasAnswered = true;
        gameState.eliminated.push({
            firstName: player.firstName,
            lastName: player.lastName,
            studentId: player.studentId,
            correctAnswers: player.correctAnswers,
            eliminatedAt: new Date(),
            eliminatedAtQuestion: gameState.currentQuestionIndex + 1,
            reason: 'timeout'
        });
        
        socket.emit('player-eliminated', {
            correctAnswers: player.correctAnswers,
            totalQuestions: gameState.questions.length,
            reason: 'timeout'
        });
        
        // Update admins
        broadcastToAdmins('player-eliminated', {
            player: {
                firstName: player.firstName,
                lastName: player.lastName,
                studentId: player.studentId,
                correctAnswers: player.correctAnswers,
                eliminatedAtQuestion: gameState.currentQuestionIndex + 1
            },
            reason: 'timeout',
            remainingPlayers: Array.from(gameState.players.values()).filter(p => p.status === 'playing').length
        });
        
        // Check if all active players have answered
        checkIfAllPlayersAnswered();
    });

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
        
        console.log('Admin reset the game');
        resetGame();
        
        io.emit('game-reset', {
            message: 'بازی ریست شد'
        });
        
        // Send updated game state to all admins with current players
        broadcastToAdmins('game-state-update', {
            status: gameState.status,
            playerCount: gameState.players.size,
            currentQuestion: gameState.currentQuestionIndex,
            totalQuestions: gameState.questions.length,
            players: Array.from(gameState.players.values()).map(p => ({
                socketId: p.socketId,
                firstName: p.firstName,
                lastName: p.lastName,
                studentId: p.studentId,
                status: p.status,
                correctAnswers: p.correctAnswers
            })),
            winners: gameState.winners,
            eliminated: gameState.eliminated
        });
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log(`Disconnected: ${socket.id}`);
        
        // Remove from admin list
        adminSockets.delete(socket.id);
        
        // Remove player
        const player = gameState.players.get(socket.id);
        if (player) {
            gameState.players.delete(socket.id);
            console.log(`Player left: ${player.firstName} ${player.lastName}`);
            
            // Update admins
            broadcastToAdmins('player-left', {
                player: {
                    firstName: player.firstName,
                    lastName: player.lastName,
                    studentId: player.studentId
                },
                totalPlayers: gameState.players.size
            });
        }
    });
});

// Helper Functions
function checkIfAllPlayersAnswered() {
    const activePlayers = Array.from(gameState.players.values()).filter(p => p.status === 'playing');
    const answeredPlayers = activePlayers.filter(p => p.hasAnswered);
    
    console.log(`Players answered: ${answeredPlayers.length}/${activePlayers.length}`);
    
    if (activePlayers.length === 0) {
        endGame();
        return;
    }
    
    // If all active players have answered, move to next question
    if (answeredPlayers.length === activePlayers.length) {
        console.log('All players answered, moving to next question...');
        
        // Reset hasAnswered flag for next question
        gameState.players.forEach(player => {
            player.hasAnswered = false;
        });
        
        // Wait a bit before sending next question
        setTimeout(() => {
            moveToNextQuestion();
        }, 3000); // 3 seconds delay
    }
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
    
    console.log(`Sending question ${gameState.currentQuestionIndex + 1} to ${activePlayers.length} players`);
    
    // Send question to all active players
    activePlayers.forEach(player => {
        io.to(player.socketId).emit('new-question', {
            questionNumber: gameState.currentQuestionIndex + 1,
            totalQuestions: gameState.questions.length,
            question: {
                id: question.id,
                text: question.text,
                options: question.options,
                timeLimit: question.timeLimit
            }
        });
    });
    
    // Update admins
    broadcastToAdmins('question-sent', {
        questionNumber: gameState.currentQuestionIndex + 1,
        totalQuestions: gameState.questions.length,
        activePlayers: activePlayers.length
    });
}

function moveToNextQuestion() {
    gameState.currentQuestionIndex++;
    
    if (gameState.currentQuestionIndex >= gameState.questions.length) {
        endGame();
        return;
    }
    
    // Wait a bit before sending next question
    setTimeout(() => {
        sendQuestion();
    }, 1000);
}

function endGame() {
    console.log('Game ended');
    
    gameState.status = 'finished';
    
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
    
    console.log(`Winners: ${gameState.winners.length}`);
    
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
        eliminated: gameState.eliminated,
        totalPlayers: gameState.players.size
    });
    
    // Notify all players
    io.emit('game-finished', {
        message: 'بازی به پایان رسید',
        winnersCount: gameState.winners.length
    });
}

function resetGame() {
    gameState.status = 'waiting';
    
    // Keep players but reset their status
    gameState.players.forEach(player => {
        player.status = 'waiting';
        player.correctAnswers = 0;
        player.hasAnswered = false;
    });
    
    gameState.currentQuestionIndex = 0;
    gameState.winners = [];
    gameState.eliminated = [];
    gameState.startTime = null;
    
    if (gameState.questionTimer) {
        clearTimeout(gameState.questionTimer);
        gameState.questionTimer = null;
    }
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

