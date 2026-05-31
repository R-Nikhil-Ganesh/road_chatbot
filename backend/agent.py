import os
import json
import re
from groq import Groq
from backend.config import settings
from backend.database import run_query

# Initialize Groq client dynamically
client = None

def get_groq_client():
    global client
    if client is not None:
        return client
        
    # If the key is not set, try to load it dynamically (in case .env was added post-startup)
    if not settings.GROQ_API_KEY:
        from dotenv import load_dotenv
        from backend.config import BASE_DIR
        load_dotenv(BASE_DIR / ".env")
        settings.GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
        settings.GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        
    if settings.GROQ_API_KEY:
        try:
            client = Groq(api_key=settings.GROQ_API_KEY)
            return client
        except Exception as e:
            print(f"Error initializing Groq client dynamically: {e}")
            
    return None

# SQL Schema description provided to the LLM
DATABASE_SCHEMA_PROMPT = """
You are an expert SQL Assistant for "Chennai RoadWatch AI", a citizen portal.
Your job is to translate citizen queries about local roads, budgets, audits, and contractors into SQLite SELECT queries.

You have access to two tables in a SQLite database:

1. Table: `roads`
Columns:
- `record_id` (TEXT, e.g. 'RW001'): Unique road record identifier.
- `road_name` (TEXT, e.g. 'Rajiv Main Road'): Name of the road.
- `contractor_name` (TEXT, e.g. 'Arunachalam Road Works'): Name of the contractor. Links to `contractors.contractor_name`.
- `allotted_budget_inr` (INTEGER): The budget allocated to the road in INR.
- `amount_used_inr` (INTEGER): The actual budget spent on the road.
- `budget_note` (TEXT, e.g. 'Within budget', or details of budget overruns).
- `materials_used` (TEXT): Pipe-separated string of materials (e.g. 'Concrete M30 | River sand').
- `audit_1_date` (TEXT), `audit_1_status` (TEXT), `audit_1_remarks` (TEXT)
- `audit_2_date` (TEXT), `audit_2_status` (TEXT), `audit_2_remarks` (TEXT)
- `audit_3_date` (TEXT), `audit_3_status` (TEXT), `audit_3_remarks` (TEXT)
  * Note: Audit status values are typically 'Passed', 'Failed', or 'Conditional Pass'.
- `construction_start_date` (TEXT), `construction_end_date` (TEXT), `date_opened_to_public` (TEXT), `last_maintenance_date` (TEXT)
- `latitude` (REAL), `longitude` (REAL): Map coordinates.
- `overall_status` (TEXT): 'Passed', 'Failed', or 'Conditional Pass' based on the latest completed audit.

2. Table: `contractors`
Columns:
- `contractor_id` (TEXT, e.g. 'CON001'): Unique contractor identifier.
- `contractor_name` (TEXT): Contractor company name. Matches `roads.contractor_name`.
- `registered_address` (TEXT), `phone` (TEXT), `email` (TEXT)
- `gst_number` (TEXT), `license_number` (TEXT), `license_class` (TEXT) (e.g. Class AA, Class B, Class C)
- `license_expiry_date` (TEXT), `year_of_registration` (INTEGER), `experience_years` (INTEGER)
- `specialization` (TEXT) (e.g. 'Flyover Projects', 'Coastal Road Works')
- `total_projects_handled` (INTEGER), `projects_completed` (INTEGER), `projects_ongoing` (INTEGER)
- `total_contract_value_inr` (INTEGER), `avg_contract_value_inr` (INTEGER)
- `performance_rating` (REAL): Rating from 0.0 to 5.0.
- `rating_grade` (TEXT) (e.g. 'Excellent', 'Average', 'Poor')
- `payment_status` (TEXT), `last_payment_received_date` (TEXT), `pending_dues_inr` (INTEGER)
- `blacklist_status` (TEXT) (e.g. 'Blacklisted', 'Active - Clean Record', 'Previously Blacklisted - Now Active')
- `blacklist_date` (TEXT), `blacklist_reason` (TEXT), `blacklist_lifted_date` (TEXT), `blacklist_lifted_reason` (TEXT)
- `performance_issues_noted` (TEXT)
- `empanelled_with` (TEXT) (e.g. 'NHAI | CMDA | PWD Tamil Nadu')

SQL Querying Tips:
- Do NOT perform updates, inserts, deletes, or drop tables. Only write SELECT statements.
- We have registered a custom SQLite function `NORMALIZE_SPELLING(text)` which makes matches spelling-insensitive (e.g. it collapses double letters like 'Meenambakkam' and 'Meenambakam' both to 'menabakam', and removes spaces and punctuation).
- When searching for a road or contractor by name from user input, ALWAYS use `NORMALIZE_SPELLING(column) LIKE '%' || NORMALIZE_SPELLING('user_input') || '%'` for maximum robust matching (e.g. `WHERE NORMALIZE_SPELLING(road_name) LIKE '%' || NORMALIZE_SPELLING('Meenambakam') || '%'`).
- If you need to join tables, use `JOIN contractors ON roads.contractor_name = contractors.contractor_name`.
- Treat column names exactly as defined above (case-sensitive).
- Use `allotted_budget_inr` and `amount_used_inr` for budget comparisons. For budget overrun, search for rows where `amount_used_inr > allotted_budget_inr`.
"""

SYSTEM_PROMPT_SQL_GEN = DATABASE_SCHEMA_PROMPT + """
You must output a raw JSON object with the following structure:
{
  "reasoning": "Your thoughts on which columns/tables are needed, how you resolved references from the conversation history, and how to write the SQL query.",
  "sql_query": "The SQLite SELECT query. Write this as a clean string on a single line, or null if database access is not needed.",
  "direct_answer": "Provide a direct response here ONLY if the user is greeting you or asking a general question not related to the dataset. Otherwise, set this to null."
}
Ensure your output is strictly valid JSON, without markdown formatting outside the JSON, or leading/trailing text.

CONTEXT RESOLUTION RULE:
You will be given the recent conversation history between the citizen and the assistant.
Analyze the history to resolve references (e.g. if the user says 'Who built it?' or 'Who is the contractor?' or 'Show its audits' after discussing a road, identify the road name from the history, and write the SQL query for that road).
If no specific road or contractor is referenced in the query, but one was discussed in the last 1-2 turns, assume the user is still talking about it.
"""

SYSTEM_PROMPT_RESPONSE_GEN = """
You are "Chennai RoadWatch AI", a citizen portal chatbot designed to help the public understand local road works, contractor quality, and budgets.
You are given the conversation history, the citizen's latest question, the SQL query that was run, and the raw SQL results.
Translate the SQL results into a polite, informative, citizen-friendly response.

Guidelines:
- Present the information clearly. If the result contains multiple rows, format them as a clean Markdown list or table.
- Be precise. State only the facts returned by the database. Do not hallucinate details.
- Convert large currency values to user-friendly formats if helpful (e.g., in Lakhs or Crores, where 1 Lakh = 100,000 INR and 1 Crore = 10,000,000 INR), but keep the exact numbers too.
- If the SQL results are empty, politely state that no matching records were found in the database.
- Address the user professionally and helpfully as a civic service agent.
"""

def clean_json_response(raw_text: str) -> dict:
    """Extracts and parses JSON from raw LLM text using regex fallback."""
    raw_text = raw_text.strip()
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        # Fallback 1: Extract block within triple backticks
        match = re.search(r'```json\s*(.*?)\s*```', raw_text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
                
        # Fallback 2: Find first '{' and last '}'
        match_bracket = re.search(r'(\{.*})', raw_text, re.DOTALL)
        if match_bracket:
            try:
                return json.loads(match_bracket.group(1))
            except json.JSONDecodeError:
                pass
        raise ValueError("Could not parse JSON from model output.")

def call_llm(messages: list[dict]) -> str:
    """Synchronously calls the Groq API client with a list of message objects."""
    groq_client = get_groq_client()
    if not groq_client:
        raise ValueError("Groq client not initialized. Ensure GROQ_API_KEY is configured in your .env file.")
        
    completion = groq_client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=messages,
        temperature=0.1,  # Low temperature for highly deterministic queries and structure
    )
    return completion.choices[0].message.content

def ask_agent(messages: list[dict]) -> dict:
    """Core agent loop with conversation history:
    1. Translate question to SQL (using history context).
    2. Run SQL on DB (with self-correction).
    3. Generate natural language response (using history context).
    Returns: {"answer": str, "sql_query": str | None, "error": bool}
    """
    groq_client = get_groq_client()
    if not groq_client:
        return {
            "answer": "⚠️ **Groq API Key Missing**: Please configure your `GROQ_API_KEY` in the `.env` file in the project root to run this chatbot.",
            "sql_query": None,
            "error": True
        }
        
    try:
        user_question = messages[-1]["content"]
        print(f"Agent received question: '{user_question}' (Conversation length: {len(messages)})")
        
        # Step 1: SQL Generation
        sql_gen_messages = [
            {"role": "system", "content": SYSTEM_PROMPT_SQL_GEN}
        ]
        
        # Append history context (last 6 messages) excluding the latest user query
        for msg in messages[:-1][-6:]:
            sql_gen_messages.append({"role": msg["role"], "content": msg["content"]})
            
        sql_gen_messages.append({
            "role": "user",
            "content": f"Analyze the conversation history above (if any) and translate this latest query into SQL: '{user_question}'"
        })
        
        raw_response = call_llm(sql_gen_messages)
        parsed = clean_json_response(raw_response)
        
        sql_query = parsed.get("sql_query")
        direct_answer = parsed.get("direct_answer")
        
        # If it's a direct conversation question (like 'hello')
        if direct_answer and not sql_query:
            return {
                "answer": direct_answer,
                "sql_query": None,
                "error": False
            }
            
        if not sql_query:
            return {
                "answer": "I'm sorry, I couldn't figure out how to look up that data. Could you try rephrasing your question?",
                "sql_query": None,
                "error": True
            }
            
        # Step 2: Database Execution (with self-correction)
        db_results = run_query(sql_query)
        
        # Check for error
        if isinstance(db_results, str) and db_results.startswith("SQL Execution Error:"):
            # Attempt self-correction
            print(f"Query failed: {sql_query}. Attempting self-correction...")
            correction_messages = [
                {"role": "system", "content": SYSTEM_PROMPT_SQL_GEN},
                {"role": "user", "content": f"The SQL query you generated: '{sql_query}' failed with error: '{db_results}'. Correct the SELECT query and output the raw JSON."}
            ]
            raw_response = call_llm(correction_messages)
            parsed = clean_json_response(raw_response)
            sql_query = parsed.get("sql_query")
            
            if sql_query:
                db_results = run_query(sql_query)
            else:
                db_results = "Error: Self-correction failed to generate a SQL query."
                
        # If still failed
        if isinstance(db_results, str) and (db_results.startswith("SQL Execution Error:") or db_results.startswith("Error:")):
            return {
                "answer": f"I encountered an error querying the database: `{db_results}`. Please try asking differently.",
                "sql_query": sql_query,
                "error": True
            }
            
        # Step 3: Response Generation
        result_str = json.dumps(db_results, indent=2)
        
        response_messages = [
            {"role": "system", "content": SYSTEM_PROMPT_RESPONSE_GEN}
        ]
        # Append history
        for msg in messages[:-1][-6:]:
            response_messages.append({"role": msg["role"], "content": msg["content"]})
            
        response_messages.append({
            "role": "user",
            "content": f"Citizen's latest query: '{user_question}'\nSQL query executed: {sql_query}\nSQL results returned:\n{result_str}\n\nFormulate the final response."
        })
        
        answer = call_llm(response_messages)
        
        return {
            "answer": answer,
            "sql_query": sql_query,
            "error": False
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "answer": f"An error occurred in the AI agent loop: `{str(e)}`",
            "sql_query": None,
            "error": True
        }
