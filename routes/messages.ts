import express from 'express';
import multer from 'multer';
import path from 'path';
// import Message from '../models/Message'; // You'll need to create this model

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'files/'); // Make sure this directory exists
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Send a message (text or image) - NEW ROUTE
router.post('/send', upload.single('imageFile'), async (req, res) => {
    try {
        const { senderId, recepientId, messageType, messageText } = req.body;

        if (messageType === 'text') {
            // Your Message model logic here
            // const message = new Message({
            //     senderId,
            //     recepientId,
            //     messageType: 'text',
            //     message: messageText,
            //     timeStamp: new Date(),
            //     imageUrl: null
            // });
            // await message.save();

            res.status(200).json({ message: 'Text message sent successfully' });
        } else if (messageType === 'image') {
            const imageName = req.file?.filename;
            const imageUrl = imageName ? `/files/${imageName}` : null;

            // Your Message model logic here
            // const message = new Message({
            //     senderId,
            //     recepientId,
            //     messageType: 'image',
            //     message: null,
            //     timeStamp: new Date(),
            //     imageUrl: imageUrl
            // });
            // await message.save();

            res.status(200).json({ message: 'Image sent successfully' });
        }
    } catch (error) {
        console.log('Error sending message:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get messages between two users - NEW ROUTE
router.get('/:userId/:recepientId', async (req, res) => {
    try {
        const { userId, recepientId } = req.params;

        // Your Message model logic here
        // const messages = await Message.find({
        //     $or: [
        //         { senderId: userId, recepientId: recepientId },
        //         { senderId: recepientId, recepientId: userId }
        //     ]
        // }).populate('senderId', '_id name');

        // Temporary response until you create Message model
        res.json([]);
    } catch (error) {
        console.log('Error fetching messages:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Delete messages - NEW ROUTE
router.post('/deleteMessages', async (req, res) => {
    try {
        const { messages } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'Invalid messages array' });
        }

        // Your Message model logic here
        // await Message.deleteMany({ _id: { $in: messages } });

        res.status(200).json({ message: 'Messages deleted successfully' });
    } catch (error) {
        console.log('Error deleting messages:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Mark message as read - NEW ROUTE
router.post('/mark-read', async (req, res) => {
    try {
        const { messageId, userId } = req.body;

        // Your Message model logic here
        // await Message.findByIdAndUpdate(messageId, {
        //     $addToSet: { readBy: userId }
        // });

        res.status(200).json({ message: 'Message marked as read' });
    } catch (error) {
        console.log('Error marking message as read:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Get unread message count - NEW ROUTE
router.get('/unread/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Your Message model logic here
        // const unreadCount = await Message.countDocuments({
        //     recepientId: userId,
        //     readBy: { $ne: userId }
        // });

        res.status(200).json({ unreadCount: 0 });
    } catch (error) {
        console.log('Error getting unread count:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;