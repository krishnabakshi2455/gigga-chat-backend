import express from 'express';
import mongoose from 'mongoose';
import bodyparser from "body-parser";
import passport from "passport"
import { Strategy as LocalStrategy } from 'passport-local';
import cors from "cors"
import JWT from "jsonwebtoken"
import dotenv from "dotenv";
import User from "./models/user";
import Message from "./models/message";




dotenv.config();
const app = express();
const jwtsecret = process.env.JWT_SECRET || ""

const port = 8000


app.use(cors());

app.use(bodyparser.urlencoded({ extended: false }));


app.use(bodyparser.json())

app.use(passport.initialize())

const mongoURL = process.env.MONGODB_URL;

if (!mongoURL) {
    throw new Error("❌ MONGODB_URL is not defined in environment variables.");
}
mongoose.connect(mongoURL).then(() => {
    console.log("connected to mongodb");
}).catch(() => {
    console.log("error connected to mongodb");
})





//route for registration of the user

// input register
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




// //endpoint for logging in of that particular user
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
        res.status(500).json({Message:"Error Fetching Users"})
    })
})

















app.listen(port, () => {
    console.log(`the server has started on port ${port}`);
})