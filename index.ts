import express from 'express';
import mongoose from 'mongoose';
import bodyparser from "body-parser";
import passport from "passport"
import { Strategy as LocalStrategy } from 'passport-local';
import cors from "cors"
import JWT from "jsonwebtoken"
import dotenv from "dotenv";
import User from "./models/user";
import http from 'http';
import { Server } from 'socket.io';
import socket_messages from './controllers/socket.chat';
import messages from './controllers/messages';
import delete_message from './controllers/delete-message'


dotenv.config();
const app = express();
const jwtsecret = process.env.JWT_SECRET || ""
const server = http.createServer(app);
const port = 8000

export const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins in development
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 30000,
});

app.use(cors());
app.use(bodyparser.urlencoded({ extended: false }));
app.use(bodyparser.json());
app.use(passport.initialize());

const mongoURL = process.env.MONGODB_URL;

if (!mongoURL) {
    throw new Error("❌ MONGODB_URL is not defined in environment variables.");
}

mongoose.connect(mongoURL).then(() => {
    console.log("connected to mongodb");
}).catch(() => {
    console.log("error connected to mongodb");
});

// Use the messages router for HTTP routes
app.use("/api/", messages);
app.use("/api/delete", delete_message)

// Initialize socket.io with the server
socket_messages(io);

// Health check endpoint - add this with your other routes
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

//route for registration of the user
app.post("/register", (req, res) => {
    const { name, email, password, image } = req.body;

    // create a new User object
    const newUser = new User({ name, email, password, image });

    // save the user to the database
    newUser
        .save()
        .then(() => {
            res.status(200).json({ message: "User registered successfully" });
        })
        .catch((err) => {
            console.log("Error registering user", err);
            res.status(500).json({ message: "Error registering the user!" });
        });
});

// google register
app.post("/googleauth", async (req, res) => {
    const { name, email, image } = req.body;

    try {
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            // Generate token for existing user
            const token = JWT.sign({ userId: existingUser._id }, jwtsecret, { expiresIn: "30m" });
            return res.status(200).json({
                message: "User logged in successfully",
                token,
                user: existingUser
            });
        }

        const newUser = new User({ name, email, image });
        await newUser.save();

        // Generate token for new user
        const token = JWT.sign({ userId: newUser._id }, jwtsecret, { expiresIn: "30m" });
        res.status(200).json({
            message: "Google user registered successfully",
            token,
            user: newUser
        });
    } catch (err) {
        console.log("Error registering Google user:", err);
        res.status(500).json({ message: "Error registering Google user" });
    }
});

//function to create a token for the user
const createToken = (userId: any) => {
    // Set the token payload
    const payload = {
        userId: userId,
    };

    // Generate the token with a secret key and expiration time
    const token = JWT.sign(payload, jwtsecret, { expiresIn: "30m" });

    return token;
};

//endpoint for logging in of that particular user
app.post("/login", (req, res) => {
    const { email, password } = req.body;

    //check if the email and password are provided
    if (!email || !password) {
        return res
            .status(404)
            .json({ message: "Email and the password are required" });
    }

    //check for that user in the database
    User.findOne({ email })
        .then((user) => {
            if (!user) {
                //user not found
                return res.status(404).json({ message: "User not found" });
            }

            //compare the provided passwords with the password in the database
            if (user.password !== password) {
                return res.status(404).json({ message: "Invalid Password!" });
            }

            const token = createToken(user._id);
            res.status(200).json({ token });
        })
        .catch((error) => {
            console.log("error in finding the user", error);
            res.status(500).json({ message: "Internal server Error!" });
        });
});

// end point to access all the loggedin users 
app.get("/users/:userId", (req, res) => {
    const loggedInUersId = req.params.userId
    User.find({ _id: { $ne: loggedInUersId } }).then((users) => {
        res.status(200).json(users)
    }).catch((error) => {
        console.log("Error fetching users", error);
        res.status(500).json({ Message: "Error Fetching Users" })
    })
})

// endpoint to send a friend request
app.post("/friend-request", async (req, res) => {
    const { currentUserId, selectedUserId } = req.body;

    try {
        //update the recepient's friendRequestsArray!
        await User.findByIdAndUpdate(selectedUserId, {
            $push: { freindRequests: currentUserId },
        });

        //update the sender's sentFriendRequests array
        await User.findByIdAndUpdate(currentUserId, {
            $push: { sentFriendRequests: selectedUserId },
        });

        res.sendStatus(200);
    } catch (error) {
        res.sendStatus(500);
    }
});

// endpoint to show all the friend requests recieved a particaular user
app.get("/friend-request/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        //fetch the user document based on the User id
        const user = await User.findById(userId)
            .populate("freindRequests", "name email image")
            .lean();

        const freindRequests = user?.freindRequests;

        res.json(freindRequests);
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// endpoint to show the number of friend request and the people user sent to
app.get("/friend-requests/sent/:userId", async (req, res) => {
    try {
        const { userId } = req.params

        const user = await User.findById(userId).populate("sentFriendRequests", "name email image").lean()

        const sentFriendRequests = user?.sentFriendRequests

        res.json(sentFriendRequests)
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal Server Error" })
    }
})

// endpoint to accept a friend request
app.post("/friend-request/accept", async (req, res) => {
    try {
        const { senderId, recepientId } = req.body;

        // Retrieve both users
        const sender = await User.findById(senderId);
        const recepient = await User.findById(recepientId);

        if (!sender || !recepient) {
            return res.status(404).json({ message: "User not found" });
        }

        // Add each other as friends (prevent duplicates)
        if (!sender.friends.includes(recepientId)) {
            sender.friends.push(recepientId);
        }
        if (!recepient.friends.includes(senderId)) {
            recepient.friends.push(senderId);
        }

        // Remove request from recipient's friendRequests
        recepient.freindRequests = recepient.freindRequests?.filter(
            (request) => request.toString() !== senderId.toString()
        ) || [];

        // Remove request from sender's sentFriendRequests
        sender.sentFriendRequests = sender.sentFriendRequests?.filter(
            (request) => request.toString() !== recepientId.toString()
        ) || [];

        await sender.save();
        await recepient.save();

        res.status(200).json({ message: "Friend Request accepted successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// endpoint to decline a friend request
app.post("/friend-request/reject", async (req, res) => {
    const { senderId, recepientId } = req.body;

    // Retrieve both users
    const sender = await User.findById(senderId);
    const recepient = await User.findById(recepientId);

    if (!sender || !recepient) {
        return res.status(404).json({ message: "User not found" });
    }

    // Remove request from recipient's friendRequests
    recepient.freindRequests = recepient.freindRequests?.filter(
        (request) => request.toString() !== senderId.toString()
    ) || [];

    // Remove request from sender's sentFriendRequests
    sender.sentFriendRequests = sender.sentFriendRequests?.filter(
        (request) => request.toString() !== recepientId.toString()
    ) || [];

    await sender.save();
    await recepient.save();

    res.status(200).json({ message: "Friend Request rejected successfully" });
})

// endpoint to fetch friends of the user
app.get("/accepted-friends/:userId", async (req, res) => {
    try {
        const { userId } = req.params
        const user = await User.findById(userId).populate(
            "friends",
            "name email image"
        )
        const acceptedFriends = user?.friends
        res.json(acceptedFriends)
    } catch (error) {
        console.log("error=>", error);
        res.status(500).json({ message: "Internel Server Error" })
    }
})

// endpoint to check if the user is friend with that other user
app.get("/friends/:userId", async (req, res) => {
    try {

        const { userId } = req.params

        User.findById(userId).populate("friends").then((user) => {
            if (!user) {
                return res.status(404).json({ message: "User not found" })
            }
            const friendsIds = user?.friends?.map((item) => item._id)
            res.status(200).json(friendsIds)
        })

    } catch (error) {
        console.log("error=>", error);
        res.status(500).json({ message: "Internel Server Error" })
    }
})

server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`WebSocket server ready for connections`);
});