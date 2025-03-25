import fs from 'fs-extra';
import fetch from 'node-fetch';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { Solver } from '2captcha-ts';
import { GoogleGenerativeAI } from '@google/generative-ai';
import TelegramBot from 'node-telegram-bot-api';

const readline = createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => readline.question(query, resolve));

let solver;
let model;
let genAI;
let telegramBot;
let telegramChatId;
const MAX_RETRIES = 3;
const MAX_LOGIN_ATTEMPTS = 10;
const INITIAL_RETRY_DELAY = 5000;
const CAPTCHA_TIMEOUT = 120000; // 2 minutes timeout for captcha solving

// Generate unique app ID for each session
function generateAppId() {
  const hexDigits = '0123456789abcdef';
  let appId = '67';
  for (let i = 0; i < 22; i++) {
    appId += hexDigits[Math.floor(Math.random() * 16)];
  }
  return appId;
}

// Get base headers for requests
function getHeaders() {
  return {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };
}

// Send status message to Telegram
async function sendTelegramStatus(message) {
  if (telegramBot && telegramChatId) {
    try {
      await telegramBot.sendMessage(telegramChatId, message, { parse_mode: 'HTML' });
    } catch (error) {
      console.log(chalk.red(`Error sending Telegram message: ${error.message}`));
    }
  }
}

// Setup captcha solver based on user choice
function setupCaptchaSolver(apiKey, solverType) {
  model = solverType;
  if (solverType === '2captcha') {
    solver = new Solver(apiKey);
  } else if (solverType === 'manual') {
    solver = null;
  } else if (solverType === 'telegram') {
    telegramBot = new TelegramBot(apiKey, { polling: true });
    solver = null;
    
    // Handle incoming messages
    telegramBot.on('message', (msg) => {
      if (!telegramChatId) {
        telegramChatId = msg.chat.id;
        console.log(chalk.green(`✓ Telegram chat ID set: ${telegramChatId}`));
      }
    });
  } else if (solverType === 'gemini') {
    genAI = new GoogleGenerativeAI(apiKey);
    solver = null;
  }
  return solver;
}

// Get puzzle ID for captcha
async function getPuzzleId(appId) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(
        `https://www.aeropres.in/chromeapi/dawn/v1/puzzle/get-puzzle?appid=${appId}`,
        { headers: getHeaders() }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(chalk.green(`✓ Got puzzle ID: ${data.puzzle_id}`));
      return data.puzzle_id;
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Failed to get puzzle ID after ${MAX_RETRIES} attempts: ${error.message}`);
      }
      console.log(chalk.yellow(`Attempt ${attempt}/${MAX_RETRIES} failed, retrying...`));
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// Save captcha image to file
async function saveCaptchaImage(base64Image) {
  try {
    await fs.writeFile('temp_captcha.png', base64Image, 'base64');
    console.log(chalk.green('✓ Saved captcha image to temp_captcha.png'));
  } catch (error) {
    throw new Error(`Failed to save captcha image: ${error.message}`);
  }
}

// Get puzzle image for solving
async function getPuzzleImage(puzzleId, appId) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(
        `https://www.aeropres.in/chromeapi/dawn/v1/puzzle/get-puzzle-image?puzzle_id=${puzzleId}&appid=${appId}`,
        { headers: getHeaders() }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(chalk.green('✓ Got puzzle image'));
      return data.imgBase64;
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Failed to get puzzle image after ${MAX_RETRIES} attempts: ${error.message}`);
      }
      console.log(chalk.yellow(`Attempt ${attempt}/${MAX_RETRIES} failed, retrying...`));
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// Process and solve captcha image
async function processCaptcha(base64Image) {
  try {
    if (model === 'manual') {
      await saveCaptchaImage(base64Image);
      const captchaText = await question(chalk.cyan('\nPlease check temp_captcha.png and enter the captcha code: '));
      return captchaText;
    }

    if (model === 'telegram') {
      await saveCaptchaImage(base64Image);
      
      // Send image to Telegram
      await telegramBot.sendPhoto(telegramChatId, 'temp_captcha.png', {
        caption: 'Please solve this captcha. Send the text/numbers you see in the image.'
      });
      
      // Wait for response
      const captchaText = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Captcha solving timeout'));
        }, CAPTCHA_TIMEOUT);
        
        telegramBot.once('message', (msg) => {
          clearTimeout(timeout);
          resolve(msg.text.trim());
        });
      });
      
      console.log(chalk.green(`✓ Received captcha solution from Telegram: ${captchaText}`));
      return captchaText;
    }

    let captchaText;
    if (model === '2captcha') {
      const result = await solver.imageCaptcha({
        body: base64Image,
        numeric: 1,
        minLength: 4,
        maxLength: 4
      });
      captchaText = result.data;
    } else if (model === 'gemini') {
      await saveCaptchaImage(base64Image);
      const geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await geminiModel.generateContent([
        'What is the text shown in this captcha image? The text may contain both letters and numbers. Only respond with the exact text shown, nothing else. Be very careful to distinguish between similar looking characters (like 0 vs O, 1 vs I, etc).',
        { inlineData: { data: base64Image, mimeType: 'image/png' } }
      ]);
      captchaText = result.response.text().trim();
    }
    
    console.log(chalk.green(`✓ Solved captcha: ${captchaText}`));
    return captchaText;
  } catch (error) {
    throw new Error(`Failed to solve captcha: ${error.message}`);
  }
}

// Get user points after successful login
async function getUserPoints(token, appId) {
  try {
    const headers = {
      ...getHeaders(),
      'Authorization': `Bearer ${token}`
    };
    
    const response = await fetch(
      `https://www.aeropres.in/api/atom/v1/userreferral/getpoint?appid=${appId}`,
      { headers }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.success) {
      const { referralPoint, rewardPoint } = data.data;
      const totalPoints = (
        (referralPoint?.commission || 0) +
        (rewardPoint?.points || 0) +
        (rewardPoint?.registerpoints || 0) +
        (rewardPoint?.twitter_x_id_points || 0) +
        (rewardPoint?.discordid_points || 0) +
        (rewardPoint?.telegramid_points || 0)
      );
      return totalPoints;
    }
    return 0;
  } catch (error) {
    console.log(chalk.red(`Error getting points: ${error.message}`));
    return 0;
  }
}

// Calculate delay for next retry attempt with exponential backoff
function calculateRetryDelay(attempt) {
  return INITIAL_RETRY_DELAY * Math.pow(1.5, attempt - 1);
}

// Perform login for a single account with retries
async function loginAccountWithRetry(email, password) {
  let loginAttempt = 1;
  let lastError = null;
  
  while (true) { // Keep trying until success
    console.log(chalk.cyan(`\nAttempt ${loginAttempt} for ${email}`));
    await sendTelegramStatus(`🔄 <b>Login Attempt ${loginAttempt}</b>\n\nAccount: ${email}`);
    
    try {
      const appId = generateAppId();
      
      // Get and solve captcha
      const puzzleId = await getPuzzleId(appId);
      const imageBase64 = await getPuzzleImage(puzzleId, appId);
      const captchaText = await processCaptcha(imageBase64);
      
      // Prepare login data
      const loginData = {
        username: email,
        password: password,
        logindata: {
          _v: { version: '1.1.2' },
          datetime: new Date().toISOString()
        },
        puzzle_id: puzzleId,
        ans: captchaText
      };

      // Attempt login
      const loginResponse = await fetch(
        `https://www.aeropres.in/chromeapi/dawn/v1/user/login/v2?appid=${appId}`,
        {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(loginData)
        }
      );

      const loginResult = await loginResponse.json();
      
      // Check if the message indicates successful login
      if (loginResult.message === 'Successfully logged in!') {
        const token = loginResult.data.token;
        const points = await getUserPoints(token, appId);
        
        console.log(chalk.green(`✓ Login successful for ${email}`));
        console.log(chalk.green(`✓ Points: ${points}`));
        
        await sendTelegramStatus(`✅ <b>Login Successful!</b>\n\nAccount: ${email}\nPoints: ${points}`);
        
        // Save successful login
        await fs.appendFile('successful_logins.txt', `${email}:${token}\n`);
        return true;
      } else {
        throw new Error(loginResult.message || 'Unknown error');
      }
    } catch (error) {
      lastError = error;
      console.log(chalk.red(`✗ Login attempt ${loginAttempt} failed for ${email}: ${error.message}`));
      
      await sendTelegramStatus(`❌ <b>Login Failed</b>\n\nAccount: ${email}\nAttempt: ${loginAttempt}\nError: ${error.message}`);
      
      // Calculate delay for next attempt
      const delay = calculateRetryDelay(loginAttempt);
      const delaySeconds = Math.round(delay / 1000);
      
      await sendTelegramStatus(`⏳ Waiting ${delaySeconds} seconds before next attempt...`);
      console.log(chalk.yellow(`Waiting ${delaySeconds} seconds before next attempt...`));
      await new Promise(resolve => setTimeout(resolve, delay));
      
      loginAttempt++;
    }
  }
}

// Read credentials from file
async function readCredentials(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.split('\n')
      .map(line => line.trim())
      .filter(line => line.includes(':'))
      .map(line => {
        const [email, password] = line.split(':');
        return { email: email.trim(), password: password.trim() };
      });
  } catch (error) {
    console.log(chalk.red(`Error reading credentials: ${error.message}`));
    return [];
  }
}

// Cleanup function to stop Telegram bot
async function cleanup() {
  if (telegramBot) {
    telegramBot.stopPolling();
  }
  readline.close();
}

// Main function
async function main() {
  console.log(chalk.cyan('\nChoose your captcha solver:'));
  console.log('1. 2captcha');
  console.log('2. Solve captcha using Gemini');
  console.log('3. Manual Input');
  console.log('4. Telegram Bot');
  
  const solverChoice = await question('Enter your choice (1, 2, 3, or 4): ');
  const solverType = solverChoice === '1' ? '2captcha' : 
                     solverChoice === '2' ? 'gemini' :
                     solverChoice === '4' ? 'telegram' : 'manual';
  
  let apiKey = '';
  if (solverType !== 'manual') {
    apiKey = await question(`Enter your ${
      solverType === 'gemini' ? 'Gemini' : 
      solverType === 'telegram' ? 'Telegram Bot' : '2captcha'
    } API key: `);
  }
  
  setupCaptchaSolver(apiKey, solverType);
  
  if (solverType === 'telegram') {
    console.log(chalk.yellow('\nWaiting for first message in Telegram bot to get chat ID...'));
    console.log(chalk.cyan('Please send any message to the bot to continue.'));
    
    // Wait for chat ID to be set
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (telegramChatId) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }
  
  const credentials = await readCredentials('file.txt');
  
  if (credentials.length === 0) {
    console.log(chalk.red('No valid credentials found in file.txt'));
    await cleanup();
    return;
  }

  console.log(chalk.cyan(`\nFound ${credentials.length} accounts to process`));
  await sendTelegramStatus(`🚀 <b>Starting Login Process</b>\n\nTotal Accounts: ${credentials.length}`);
  
  let successful = 0;
  let failed = 0;
  
  try {
    for (const [index, cred] of credentials.entries()) {
      console.log(chalk.cyan(`\nProcessing account ${index + 1}/${credentials.length}`));
      await sendTelegramStatus(`📝 <b>Processing Account ${index + 1}/${credentials.length}</b>`);
      
      const result = await loginAccountWithRetry(cred.email, cred.password);
      if (result) successful++; else failed++;
      
      // Wait between accounts
      if (index < credentials.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } finally {
    console.log(chalk.cyan('\nProcessing completed'));
    console.log(chalk.green(`✓ Successful logins: ${successful}`));
    console.log(chalk.red(`✗ Failed logins: ${failed}`));
    
    await sendTelegramStatus(`
🏁 <b>Processing Completed</b>

✅ Successful logins: ${successful}
❌ Failed logins: ${failed}
    `);
    
    await cleanup();
  }
}

main().catch(error => {
  console.log(chalk.red(`Fatal error: ${error.message}`));
  sendTelegramStatus(`🚨 <b>Fatal Error</b>\n\n${error.message}`).finally(cleanup);
});
