# Kidverse MVP

## Real-Time Safety Dashboard for Roblox Monitoring

### Overview

Kidverse is a comprehensive parental control and safety monitoring platform designed to help parents keep their children safe while playing Roblox. The platform provides real-time monitoring, activity tracking, and safety alerts to ensure a secure gaming experience.

### Features

- **Real-Time Monitoring**: Live tracking of Roblox gameplay sessions
- **Safety Alerts**: Instant notifications for potentially unsafe interactions
- **Activity Dashboard**: Comprehensive view of gaming patterns and behaviors
- **Friend Management**: Monitor and manage your child's Roblox friend list
- **Screen Time Tracking**: Track and set limits on gaming sessions
- **Content Filtering**: Age-appropriate game recommendations and restrictions

### Technology Stack

#### Frontend
- React 18
- TypeScript
- Tailwind CSS
- Vite
- React Router
- Chart.js for data visualization

#### Backend
- Node.js
- Express.js
- MongoDB
- Socket.io for real-time updates
- JWT authentication

### Project Structure

```
kidverse-mvp/
├── frontend/          # React frontend application
├── backend/           # Node.js/Express backend API
├── docs/              # Project documentation
└── README.md          # This file
```

### Getting Started

#### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- MongoDB (local or Atlas)

#### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/CrazyDubya/kidverse-mvp.git
   cd kidverse-mvp
   ```

2. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   ```

3. Install backend dependencies:
   ```bash
   cd ../backend
   npm install
   ```

4. Set up environment variables (see `.env.example` in each directory)

5. Start the development servers:
   
   **Backend:**
   ```bash
   cd backend
   npm run dev
   ```
   
   **Frontend:**
   ```bash
   cd frontend
   npm run dev
   ```

### Development

- Frontend runs on `http://localhost:5173`
- Backend API runs on `http://localhost:3000`

### Contributing

This is an MVP project. Contributions, issues, and feature requests are welcome!

### License

MIT License - see LICENSE file for details

### Contact

Stephen Thompson - [@CrazyDubya](https://github.com/CrazyDubya)

### Roadmap

- [ ] User authentication and authorization
- [ ] Roblox API integration
- [ ] Real-time monitoring dashboard
- [ ] Alert system implementation
- [ ] Mobile app development
- [ ] Advanced analytics and reporting
