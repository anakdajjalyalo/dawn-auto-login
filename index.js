import fs from 'fs-extra';
import fetch from 'node-fetch';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { Solver } from '2captcha-ts';
import ac from '@antiadmin/anticaptchaofficial';

const readline = createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => readline.question(query, resolve));

let solver;
let model;
const MAX_RETRIES = 3;

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

// Setup captcha solver based on user choice
function setupCaptchaSolver(apiKey, solverType) {
  model = solverType;
  if (solverType === '2captcha') {
    solver = new Solver(apiKey);
  } else {
    solver = ac;
    solver.setAPIKey(apiKey);
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
    let captchaText;
    if (model === '2captcha') {
      const result = await solver.imageCaptcha({
        body: base64Image,
        numeric: 1,
        minLength: 4,
        maxLength: 4
      });
      captchaText = result.data;
    } else {
      const result = await solver.solveImage(base64Image, true);
      captchaText = result;
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

// Perform login for a single account
async function loginAccount(email, password) {
  const appId = generateAppId();
  console.log(chalk.cyan(`\nProcessing login for ${email}`));
  
  try {
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
    
    if (loginResponse.ok) {
      const token = loginResult.data.token;
      const points = await getUserPoints(token, appId);
      
      console.log(chalk.green(`✓ Login successful for ${email}`));
      console.log(chalk.green(`✓ Points: ${points}`));
      
      // Save successful login
      await fs.appendFile('successful_logins.txt', `${email}:${token}\n`);
      return true;
    } else {
      throw new Error(loginResult.message || 'Unknown error');
    }
  } catch (error) {
    console.log(chalk.red(`✗ Login failed for ${email}: ${error.message}`));
    await fs.appendFile('failed_logins.txt', `${email}:${password}\n`);
    return false;
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

// Main function
async function main() {
  console.log(chalk.cyan('\nChoose your captcha solver:'));
  console.log('1. 2captcha');
  console.log('2. Anti-Captcha');
  
  const solverChoice = await question('Enter your choice (1 or 2): ');
  const solverType = solverChoice === '1' ? '2captcha' : 'anticaptcha';
  
  const apiKey = await question(`Enter your ${solverType} API key: `);
  
  setupCaptchaSolver(apiKey, solverType);
  
  const credentials = await readCredentials('file.txt');
  
  if (credentials.length === 0) {
    console.log(chalk.red('No valid credentials found in file.txt'));
    readline.close();
    return;
  }

  console.log(chalk.cyan(`\nFound ${credentials.length} accounts to process`));
  
  let successful = 0;
  let failed = 0;
  
  for (const [index, cred] of credentials.entries()) {
    console.log(chalk.cyan(`\nProcessing account ${index + 1}/${credentials.length}`));
    const result = await loginAccount(cred.email, cred.password);
    if (result) successful++; else failed++;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(chalk.cyan('\nProcessing completed'));
  console.log(chalk.green(`✓ Successful logins: ${successful}`));
  console.log(chalk.red(`✗ Failed logins: ${failed}`));
  
  readline.close();
}

main().catch(error => {
  console.log(chalk.red(`Fatal error: ${error.message}`));
  readline.close();
});
