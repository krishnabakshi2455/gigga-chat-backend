import { Server, Socket } from 'socket.io';
import JWT from 'jsonwebtoken';
import User from '../models/user';

const jwtsecret = process.env.JWT_SECRET || "";

const socket_messages = (io: Server) => {
    // Middleware for authentication
    io.use((socket: any, next) => {
        const token = socket.handshake.auth.token;

        if (!token) {
            return next(new Error('Authentication error: No token provided'));
        }

        try {
            const decoded = JWT.verify(token, jwtsecret) as any;
            socket.data.userId = decoded.userId;
            next();
        } catch (error) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        console.log('User connected:', socket.data.userId);

        // Join user to their own room for private messages
        socket.join(socket.data.userId);

        // Handle sending messages
        socket.on('send_message', async (data) => {
            try {
                const { receiverId, message } = data;

                // Save message to database (you'll need to create a Message model)
                // const newMessage = new Message({ sender: socket.data.userId, receiver: receiverId, content: message });
                // await newMessage.save();

                // Emit to receiver
                socket.to(receiverId).emit('receive_message', {
                    senderId: socket.data.userId,
                    message,
                    timestamp: new Date()
                });

                // Send confirmation to sender
                socket.emit('message_sent', { success: true });

            } catch (error) {
                console.error('Error sending message:', error);
                socket.emit('message_error', { error: 'Failed to send message' });
            }
        });

        // Handle typing indicators
        socket.on('typing_start', (data) => {
            socket.to(data.receiverId).emit('user_typing', {
                userId: socket.data.userId,
                isTyping: true
            });
        });

        socket.on('typing_stop', (data) => {
            socket.to(data.receiverId).emit('user_typing', {
                userId: socket.data.userId,
                isTyping: false
            });
        });

        // Handle disconnect
        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.data.userId);
        });
    });
};

export default socket_messages;