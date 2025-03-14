# Auto Login Script

An automated login script for handling multiple accounts with captcha solving capabilities and optional proxy support.

## Features

- Automated login handling for multiple accounts
- Integrated 2captcha solver for automated captcha resolution
- Optional proxy support (HTTP/HTTPS and SOCKS)
- Automatic retry mechanism for failed attempts
- Detailed logging of successful and failed logins
- Points tracking for each account
- File-based credential management

## Prerequisites

- Node.js 18 or higher
- 2captcha API key
- (Optional) Proxy list in `proxies.txt`

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

## Configuration

### Credentials File (file.txt)
Create a `file.txt` file with your credentials in the following format:
```
email@example.com:password
email2@example.com:password2
```

### Proxy Configuration (Optional)
If you want to use proxies, create a `proxies.txt` file with your proxy list:
```
http://proxy1.example.com:8080
socks5://proxy2.example.com:1080
```

## Usage

Run the script:
```bash
npm start
```

The script will:
1. Ask if you want to use proxies
2. Process each account in the credentials file
3. Handle captcha solving automatically
4. Save results to:
   - `successful_logins.txt` for successful logins
   - `failed_logins.txt` for failed attempts

## Output Files

### successful_logins.txt
Contains successful login information in the format:
```
email:password:token:points
```

### failed_logins.txt
Contains failed login attempts in the format:
```
email:password
```

## Error Handling

The script includes multiple retry mechanisms:
- Login attempts: 3 retries
- Captcha solving: 3 retries
- Network requests: 3 retries

## Security Notes

- Credentials are stored in plain text - ensure proper file permissions
- Store your API keys securely
- Use proxies to prevent IP blocking

## Dependencies

- fs-extra: File system operations
- node-fetch: HTTP requests
- 2captcha-ts: Captcha solving
- chalk: Console styling
- https-proxy-agent/socks-proxy-agent: Proxy support
