# Chennai RoadWatch AI - Citizen Audit Portal

Chennai RoadWatch AI is a full-stack citizen monitoring prototype designed to bring transparency and accountability to Chennai's road infrastructure construction, budget allocations, and contractor audit history. 

Citizens can query the local road database (200 roads) and contractor metrics (30+ contractors) using conversational natural language, alongside an interactive, color-coded map of the Chennai district.

---

## Technical Architecture

- **Backend**: FastAPI (Python 3.8+) serving REST APIs and static files.
- **Database**: In-memory SQLite database populated at server startup from the local `roadwatch_200_roads.csv` and `roadwatch_contractors.csv` files.
- **AI Agent**: A dual-phase Groq agent loop powered by `llama-3.3-70b-versatile` that converts natural language requests into SQLite query syntax, runs the query safely, self-corrects if SQL syntax errors occur, and translates the data results back into conversational citizen-friendly answers.
- **Frontend**: Responsive Single-Page Application (SPA) designed with a clean minimalist light theme (Charcoal/Amber) and interactive mapping using Leaflet.js.

---

## Getting Started & Installation

Follow these steps to run the application locally on your machine.

### 1. Clone or Open the Directory
Open your terminal in the root of the project directory `d:\road_chatbot`.

### 2. Set Up a Python Virtual Environment
Creating a virtual environment ensures Python packages are isolated.

**On Windows:**
```powershell
python -m venv venv
venv\Scripts\activate
```

**On macOS/Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Install Dependencies
Install all required libraries (FastAPI, Uvicorn, Pandas, Groq, Dotenv, and Pydantic):
```bash
pip install -r backend/requirements.txt
```

### 4. Configure Environment Variables
1. Copy the `.env.example` file to a new file named `.env`:
   ```bash
   copy .env.example .env
   ```
   *(Or on macOS/Linux: `cp .env.example .env`)*
   
2. Open the `.env` file in a text editor and add your **Groq API Key**:
   ```env
   GROQ_API_KEY=gsk_your_actual_key_here
   GROQ_MODEL=llama-3.3-70b-versatile
   HOST=127.0.0.1
   PORT=8000
   ```

---

## Running the Application

Start the backend server using Python:
```bash
python -m backend.main
```

Once started, the terminal will print:
```text
Initializing Database...
Database initialized. Loaded 200 roads and 31 contractors.
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

### Accessing the Portal
Open your web browser and go to:
👉 **[http://127.0.0.1:8000](http://127.0.0.1:8000)**

---

## How to Interact with the Portal

1. **The Premium Landing Page**: Displays live metrics (200 Roads, 30+ Contractors) directly parsed from the database. Click **Launch Citizen Portal** to transition to the live workspace.
2. **Interactive Map**: Look around the Chennai district. Roads are shown as status dots:
   - 🟢 **Green (Passed)**: Completed audits passed.
   - 🟡 **Orange (Warning)**: Conditional passes or minor discrepancies noted.
   - 🔴 **Red (Failed)**: Failed audits (e.g. missing joint sealants, failed compaction tests).
3. **Map-to-Chat Integration**: Click on any road marker to view a metadata popup. Click **Ask AI about this road** in the popup to automatically prompt the AI Assistant to pull the full audit log.
4. **Conversational Queries**: Ask the AI Assistant anything about local roads or contractor performance:
   - *"Which contractors are currently blacklisted and why?"*
   - *"Find all roads where the amount used was higher than the budget."*
   - *"Show me Sri Balaji's rating and contact information."*
   - *"List roads using 'Polymer Modified Bitumen' that had failed audits."*
5. **SQL Transparency**: For every conversational answer, you can click the **Executed SQL Query** accordion under the bot bubble to view the exact database query the AI synthesized to retrieve its facts.
