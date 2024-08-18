const express = require("express");
const app = express();
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const port = process.env.PORT || 5000;
// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.j10pchd.mongodb.net/?appName=Cluster0`;

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.j10pchd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const userCollection = client.db("job").collection("users");
    const transactionCollection = client.db("job").collection("transactions");
    const transactionSendMoneyCollection = client
      .db("job")
      .collection("transactionsSendMoney");

    const transactionCashOutCollection = client
      .db("job")
      .collection("transactionsCashOut");

    // const transactionCollectionCashIn = client.db("job").collection("transactionsCashIn");

    const verifyJWT = (req, res, next) => {
      const token = req.headers["authorization"]?.split(" ")[1];
      if (!token) return res.status(403).send("Access denied.");

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
      } catch (error) {
        console.error("JWT Verification Error:", error);
        res.status(400).send("Invalid token.");
      }
    };

    app.post("/register", async (req, res) => {
      const { name, mobile, email, pin, role } = req.body;

      try {
        const hashedPin = await bcrypt.hash(pin, 10);

        const newUser = {
          name,
          mobile,
          email,
          pin: hashedPin,
          role,
          status: "pending",
          balance: role === "User" ? 0.0 : 10000.0,
        };

        await userCollection.insertOne(newUser);

        const token = jwt.sign(
          { id: newUser._id, mobile: newUser.mobile },
          process.env.JWT_SECRET,
          { expiresIn: "1h" }
        );

        res.status(201).json({ token });
      } catch (error) {
        console.error("Error during registration:", error);
        res.status(500).json({ message: "Registration failed" });
      }
    });

    app.post("/login", async (req, res) => {
      const { email, pin } = req.body;

      try {
        const user = await userCollection.findOne({ email });
        if (!user) {
          return res.status(401).json({ message: "Invalid credentials" });
        }
        const isMatch = await bcrypt.compare(pin, user.pin);
        if (!isMatch) {
          return res.status(401).json({ message: "Invalid credentials" });
        }
        const token = jwt.sign(
          { id: user._id, email: user.email, mobile: user.mobile },
          process.env.JWT_SECRET,
          { expiresIn: "1h" }
        );
        res.status(200).json({ message: "Login successful", token });
      } catch (error) {
        res.status(500).json({ message: "Internal server error", error });
      }
    });

    app.get("/user/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const user = await userCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        res.status(200).json(user);
      } catch (error) {
        res.status(500).json({ message: "Internal server error", error });
      }
    });

    app.get("/person/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const person = await userCollection.findOne({ email });
        if (!person) {
          return res.status(404).json({ message: "Person not found" });
        }
        res.status(200).json(person);
      } catch (error) {
        res.status(500).json({ message: "Internal server error", error });
      }
    });

    app.post("/send-money", verifyJWT, async (req, res) => {
      const { recipientMobile, amount, pin } = req.body;
      const senderId = req.user.id;

      const amountNumber = Number(amount);

      if (isNaN(amountNumber)) {
        return res.status(400).json({ message: "Invalid amount" });
      }

      let fee = 0;
      if (amountNumber > 100) {
        fee = 5;
      }

      const totalAmount = amountNumber + fee;

      try {
        if (amountNumber < 50)
          return res
            .status(400)
            .json({ message: "Minimum transaction amount is 50 Taka" });

        const sender = await userCollection.findOne({
          _id: new ObjectId(senderId),
        });
        const recipient = await userCollection.findOne({
          mobile: recipientMobile,
        });

        if (!sender)
          return res.status(404).json({ message: "Sender not found" });
        if (!recipient)
          return res.status(404).json({ message: "Recipient not found" });

        const isMatch = await bcrypt.compare(pin, sender.pin);
        if (!isMatch) return res.status(403).json({ message: "Invalid PIN" });

        if (sender.balance < totalAmount)
          return res.status(400).json({ message: "Insufficient balance" });

        const resultSender = await userCollection.updateOne(
          { _id: new ObjectId(senderId) },
          { $inc: { balance: -totalAmount } }
        );
        const resultRecipient = await userCollection.updateOne(
          { mobile: recipientMobile },
          { $inc: { balance: amountNumber + fee } }
        );

        if (
          resultSender.modifiedCount === 0 ||
          resultRecipient.modifiedCount === 0
        ) {
          throw new Error("Transaction update failed");
        }

        // Save transaction history
        const transaction = {
          senderId: sender._id,
          senderName: sender.name,
          recipientId: recipient._id,
          amount: amountNumber,
          fee,
          totalAmount,
          date: new Date(),
        };

        await transactionSendMoneyCollection.insertOne(transaction);

        res.json({ message: "Transaction successful" });
      } catch (error) {
        console.error("Error during transaction:", error);
        res
          .status(500)
          .json({ message: "Transaction failed", error: error.message });
      }
    });

    app.get("/sideUser/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });

        res.status(200).json(user);
      } catch (error) {
        res.status(500).json({ message: "Internal server error", error });
      }
    });

    app.post("/cash-out", verifyJWT, async (req, res) => {
      const { agentMobile, amount, pin } = req.body;
      const userId = req.user.id;

      const amountNumber = Number(amount);
      if (isNaN(amountNumber)) {
        return res.status(400).json({ message: "Invalid amount" });
      }

      const fee = amountNumber * 0.015;
      const totalDeduction = amountNumber + fee;

      try {
        const user = await userCollection.findOne({
          _id: new ObjectId(userId),
        });
        const agent = await userCollection.findOne({
          mobile: agentMobile,
          role: "Agent",
        });

        if (!user) return res.status(404).json({ message: "User not found" });
        if (!agent) return res.status(404).json({ message: "Agent not found" });

        const isMatch = await bcrypt.compare(pin, user.pin);
        if (!isMatch) return res.status(403).json({ message: "Invalid PIN" });

        if (user.balance < totalDeduction) {
          return res.status(400).json({ message: "Insufficient balance" });
        }

        const resultUser = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $inc: { balance: -totalDeduction } }
        );

        const resultAgent = await userCollection.updateOne(
          { _id: new ObjectId(agent._id) },
          { $inc: { balance: amountNumber + fee } }
        );

        if (resultUser.modifiedCount === 0 || resultAgent.modifiedCount === 0) {
          throw new Error("Transaction update failed");
        }

        // Save transaction history
        const transaction = {
          userId: user._id,
          agentId: agent._id,
          amount: amountNumber,
          fee,
          totalDeduction,
          date: new Date(),
        };

        await transactionCashOutCollection.insertOne(transaction);

        res.json({ message: "Cash out successful" });
      } catch (error) {
        console.error("Error during cash out:", error);
        res
          .status(500)
          .json({ message: "Cash out failed", error: error.message });
      }
    });

    app.post("/cash-in-request", verifyJWT, async (req, res) => {
      const { agentMobile, amount, pin } = req.body;
      const userMobile = req.user.mobile;

      if (!agentMobile || !amount || !pin || !userMobile) {
        return res.status(400).json({ message: "All fields are required" });
      }

      try {
        const agent = await userCollection.findOne({
          mobile: agentMobile,
          role: "Agent",
        });
        if (!agent) return res.status(404).json({ message: "Agent not found" });

        const user = await userCollection.findOne({ mobile: userMobile });
        if (!user) return res.status(404).json({ message: "User not found" });

        const isMatch = await bcrypt.compare(pin, user.pin);
        if (!isMatch) return res.status(403).json({ message: "Invalid PIN" });

        const request = {
          userMobile,
          agentMobile,
          amount,
          status: "pending",
          date: new Date(),
        };

        await transactionCollection.insertOne(request);

        res.json({ message: "Cash-in request sent" });
      } catch (error) {
        console.error("Error during cash-in request:", error);
        res
          .status(500)
          .json({ message: "Cash-in request failed", error: error.message });
      }
    });

    app.get("/transactions/pending", verifyJWT, async (req, res) => {
      try {
        const agentMobile = req.user.mobile;
        const requests = await transactionCollection
          .find({ agentMobile, status: "pending" })
          .toArray();
        res.json(requests);
      } catch (error) {
        console.error("Error fetching pending requests:", error);
        res.status(500).json({
          message: "Failed to fetch pending requests",
          error: error.message,
        });
      }
    });

    app.post("/cash-in-approve", verifyJWT, async (req, res) => {
      const { requestId } = req.body;
      const agentMobile = req.user.mobile;

      try {
        const request = await transactionCollection.findOne({
          _id: new ObjectId(requestId),
          agentMobile,
          status: "pending",
        });
        if (!request)
          return res.status(404).json({ message: "Request not found" });

        const user = await userCollection.findOne({
          mobile: request.userMobile,
        });
        if (!user) return res.status(404).json({ message: "User not found" });

        const agent = await userCollection.findOne({ mobile: agentMobile });
        if (!agent) return res.status(404).json({ message: "Agent not found" });

        const amount = parseFloat(request.amount);

        if (agent.balance < amount)
          return res
            .status(400)
            .json({ message: "Agent has insufficient balance" });

        await userCollection.updateOne(
          { mobile: request.userMobile },
          { $inc: { balance: amount } }
        );
        await userCollection.updateOne(
          { mobile: agentMobile },
          { $inc: { balance: -amount } }
        );

        await transactionCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status: "accepted" } }
        );

        res.json({ message: "Cash-in request approved" });
      } catch (error) {
        console.error("Error during cash-in approval:", error);
        res
          .status(500)
          .json({ message: "Cash-in approval failed", error: error.message });
      }
    });

    app.post("/cash-in-reject", verifyJWT, async (req, res) => {
      const { requestId } = req.body;
      const agentMobile = req.user.mobile;

      try {
        const request = await transactionCollection.findOne({
          _id: new ObjectId(requestId),
          agentMobile,
          status: "pending",
        });
        if (!request)
          return res.status(404).json({ message: "Request not found" });

        await transactionCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status: "rejected" } }
        );

        res.json({ message: "Cash-in request rejected" });
      } catch (error) {
        console.error("Error during cash-in rejection:", error);
        res
          .status(500)
          .json({ message: "Cash-in rejection failed", error: error.message });
      }
    });


    app.get("/all-transactions", verifyJWT, async (req, res) => {
      try {
        // Fetch data from transactionCollection
        const transactionRequests = await transactionCollection
          .find({})
          .toArray();

        // Fetch data from transactionSendMoneyCollection
        const sendMoneyTransactions = await transactionSendMoneyCollection
          .find({})
          .toArray();

        // Fetch data from transactionCashOutCollection
        const cashOutTransactions = await transactionCashOutCollection
          .find({})
          .toArray();

        // Combine all transactions
        const allTransactions = [
          ...transactionRequests.map((t) => ({
            ...t,
            type: "Cash In Request",
          })),
          ...sendMoneyTransactions.map((t) => ({ ...t, type: "Send Money" })),
          ...cashOutTransactions.map((t) => ({ ...t, type: "Cash Out" })),
        ];

        // Sort by date if needed
        allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json(allTransactions);
      } catch (error) {
        console.error("Error fetching all transactions:", error);
        res.status(500).json({
          message: "Failed to fetch transactions",
          error: error.message,
        });
      }
    });

    app.get("/transactions", verifyJWT, async (req, res) => {
      try {
        const transactions = await transactionCollection.find({}).toArray();
        transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Log the transactions to check the format
        console.log("Transactions:", transactions);

        res.json(transactions);
      } catch (error) {
        console.error("Error fetching transactions:", error);
        res.status(500).json({
          message: "Failed to fetch transactions",
          error: error.message,
        });
      }
    });
    app.get("/transactions", verifyJWT, async (req, res) => {
      try {
        const transactions = await transactionCollection.find({}).toArray();
        transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Log the transactions to check the format
        console.log("Transactions:", transactions);

        res.json(transactions);
      } catch (error) {
        console.error("Error fetching transactions:", error);
        res.status(500).json({
          message: "Failed to fetch transactions",
          error: error.message,
        });
      }
    });

    app.post("/logout", verifyJWT, (req, res) => {
      // Here you could add any server-side logout logic if needed
      res.status(200).json({ message: "Logout successful" });
    });


    app.get("/users", async (req, res) => {
      try {
        const searchName = req.query.name || "";
        const users = await userCollection
          .find({
            name: { $regex: searchName, $options: "i" }, // Case-insensitive search
          })
          .toArray();
        res.status(200).json(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch users", error: error.message });
      }
    });

    
    app.put("/users/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      try {
        if (!["accepted", "pending"].includes(status)) {
          return res.status(400).json({ message: "Invalid status value" });
        }

        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json({ message: "User status updated successfully" });
      } catch (error) {
        console.error("Error updating user status:", error);
        res.status(500).json({
          message: "Failed to update user status",
          error: error.message,
        });
      }
    });

    app.get("/all-transactions", verifyJWT, async (req, res) => {
      try {
        // Fetch data from transactionCollection
        const transactionRequests = await transactionCollection
          .find({})
          .toArray();

        // Fetch data from transactionSendMoneyCollection
        const sendMoneyTransactions = await transactionSendMoneyCollection
          .find({})
          .toArray();

        // Fetch data from transactionCashOutCollection
        const cashOutTransactions = await transactionCashOutCollection
          .find({})
          .toArray();

        // Combine all transactions
        const allTransactions = [
          ...transactionRequests.map((t) => ({
            ...t,
            type: "Cash In Request",
          })),
          ...sendMoneyTransactions.map((t) => ({ ...t, type: "Send Money" })),
          ...cashOutTransactions.map((t) => ({ ...t, type: "Cash Out" })),
        ];

        // Sort by date if needed
        allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json(allTransactions);
      } catch (error) {
        console.error("Error fetching all transactions:", error);
        res.status(500).json({
          message: "Failed to fetch transactions",
          error: error.message,
        });
      }
    });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.error("Failed to connect to the database:", error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("server is running");
});

app.listen(port, () => {
  console.log(`server is running on port ${port}`);
});
