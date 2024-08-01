const express = require("express");
const bodyParser = require("body-parser");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const axios = require("axios");
const fs = require("fs");
const prompt = require("prompt-sync")(); // Thư viện để nhập dữ liệu từ terminal

const apiId = 21109651;
const apiHash = "42d3aba47eae69d3d94c3094d4a91537";
const phoneNumber = "84965911620";
const sessionFile = `${phoneNumber}.session`;

// Đọc chuỗi session từ tệp nếu có
let sessionString = "";
if (fs.existsSync(sessionFile)) {
  sessionString = fs.readFileSync(sessionFile, "utf-8").trim();
}

// Khởi tạo client
const client = new TelegramClient(
  new StringSession(sessionString),
  apiId,
  apiHash,
  { connectionRetries: 5 }
);

class TelegramForwarder {
  constructor() {
    this.client = client;
    this.isForwarding = false; // Biến trạng thái để kiểm soát quá trình forward
  }

  async startClient() {
    await this.client.start({
      phoneNumber: async () => phoneNumber,
      password: async () => "", // Enter your password if 2FA is enabled
      phoneCode: async () => {
        // Nhập mã xác thực từ người dùng
        const code = prompt("Enter the code you received: ");
        return code;
      },
      onError: (err) => console.log(err),
    });

    // Lưu chuỗi session sau khi đăng nhập thành công
    const stringSession = this.client.session.save();
    fs.writeFileSync(sessionFile, stringSession, "utf-8");
    console.log("Session saved successfully.");
  }

  async listChats() {
    await this.startClient();

    try {
      const dialogs = await this.client.getDialogs();
      const fileName = `chats_of_${phoneNumber}.txt`;
      const chatsFile = fs.createWriteStream(fileName, {
        flags: "w",
        encoding: "utf-8",
      });

      dialogs.forEach((dialog) => {
        console.log(`Chat ID: ${dialog.id}, Title: ${dialog.title}`);
        chatsFile.write(`Chat ID: ${dialog.id}, Title: ${dialog.title}\n`);
      });

      console.log("List of groups printed successfully!");
      chatsFile.end();
    } finally {
      await this.client.disconnect();
    }
  }

  async forwardMessagesToChannel(sourceChatIds, destinationChannelId) {
    if (this.isForwarding) {
      console.log("A forwarding process is already running.");
      return;
    }

    this.isForwarding = true;
    await this.startClient();

    try {
      let lastMessageIds = {};
      for (let chatId of sourceChatIds) {
        const messages = await this.client.getMessages(chatId, { limit: 1 });
        lastMessageIds[chatId] = messages[0] ? messages[0].id : 0;
      }

      const forwardMessages = async () => {
        console.log("Đang lắng nghe tin nhắn...");
        for (let sourceChatId of sourceChatIds) {
          const messages = await this.client.getMessages(sourceChatId, {
            minId: lastMessageIds[sourceChatId],
            limit: 100,
          });

          for (let message of messages) {
            if (message.message) {
              console.log("Tìm thấy tin nhắn");
              const apiUrl = "https://link.mekoupon.com/api/v1/custom";
              const response = await axios.post(apiUrl, {
                userText: message.message,
              });

              if (response.data.success) {
                const newText = response.data.data.newText;
                message.message = newText;
                const newMessage = await this.client.sendMessage(
                  destinationChannelId,
                  { message: message }
                );
                console.log("Đã gửi tin");

                const saveApiUrl =
                  "https://link.mekoupon.com/api/v1/custom/tele";
                await axios.post(saveApiUrl, { message_id: newMessage.id });
                console.log("Đã lưu ID của tin nhắn mới vào database");

                lastMessageIds[sourceChatId] = Math.max(
                  lastMessageIds[sourceChatId],
                  message.id
                );
              }
            }
          }
        }

        // Đặt thời gian trễ trước khi tiếp tục lắng nghe tin nhắn
        if (this.isForwarding) {
          setTimeout(forwardMessages, 10000); // delay 10 seconds
        }
      };

      forwardMessages();
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  stopForwarding() {
    this.isForwarding = false;
    console.log("Forwarding process stopped.");
  }
}

// Khởi tạo Express
const app = express();
app.use(bodyParser.json());

const forwarder = new TelegramForwarder();

app.post("/list", async (req, res) => {
  try {
    await forwarder.listChats();
    res.status(200).send("List of chats retrieved successfully.");
  } catch (error) {
    res.status(500).send("Error retrieving chats: " + error.message);
  }
});

app.get("/start", async (req, res) => {
  const sourceChatIds = [
    -1001181718749, -1001141644598, -1001325499115, -1002186521209,
  ];
  const destinationChannelId = -1002181061675;
  if (!sourceChatIds || !destinationChannelId) {
    return res.status(400).send("Missing required parameters.");
  }

  try {
    forwarder.forwardMessagesToChannel(sourceChatIds, destinationChannelId);
    res.status(200).send("Messages forwarding started successfully.");
  } catch (error) {
    res.status(500).send("Error forwarding messages: " + error.message);
  }
});

app.get("/stopForwarding", (req, res) => {
  forwarder.stopForwarding();
  res.status(200).send("Forwarding process stopped successfully.");
});

// Lắng nghe cổng 3000
app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
