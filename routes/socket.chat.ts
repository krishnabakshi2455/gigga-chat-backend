import { Server, Socket } from 'socket.io';
import JWT from 'jsonwebtoken';

const socket_messages = (io: Server) => {
    io.use((socket: any, next) => {
        const token = socket.handshake.auth.token;
        console.log('🔐 Socket connection attempt with token:', token ? 'Present' : 'Missing');
        

        if (!token) {
            console.log('❌ Authentication error: No token provided');
            return next(new Error('Authentication error: No token provided'));
        }

        try {
            const decoded = JWT.verify(token, process.env.JWT_SECRET!) as any;
            socket.data.userId = decoded.userId;
            console.log('✅ User authenticated:', socket.data.userId);
            next();
        } catch (error) {
            console.log('❌ Authentication error: Invalid token', error);
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        console.log('✅ User connected:', socket.data.userId);

        // Join user to their own room for private messages
        socket.join(socket.data.userId);

        // Send connection confirmation
        socket.emit('connected', {
            message: 'Successfully connected to socket server',
            userId: socket.data.userId
        });

        // Handle sending messages
        socket.on('send_message', async (data) => {
            try {
                console.log('📨 Received message:', data);
                const { receiverId, message, messageType } = data;

                // Emit to receiver
                socket.to(receiverId).emit('receive_message', {
                    senderId: socket.data.userId,
                    message,
                    messageType: messageType || 'text',
                    timestamp: new Date()
                });

                // Send confirmation to sender
                socket.emit('message_sent', {
                    success: true,
                    message: 'Message sent successfully'
                });

                console.log('✅ Message delivered to:', receiverId);

            } catch (error) {
                console.error('❌ Error sending message:', error);
                socket.emit('message_error', { error: 'Failed to send message' });
            }
        });

        // Add other event handlers...

        // Handle disconnect
        socket.on('disconnect', (reason) => {
            console.log('❌ User disconnected:', socket.data.userId, 'Reason:', reason);
        });
    });
};

export default socket_messages;