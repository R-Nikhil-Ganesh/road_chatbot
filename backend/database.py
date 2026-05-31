import sqlite3
import pandas as pd
import hashlib
import numpy as np
from pathlib import Path
from backend.config import settings

# Create database connection in-memory
conn = sqlite3.connect(":memory:", check_same_thread=False)

import re

def normalize_spelling(text: str) -> str:
    """Normalizes strings for phonetic/spelling-insensitive matching.
    Removes punctuation/spaces, lowercases, and collapses duplicate letters.
    """
    if not text:
        return ""
    # Convert to lowercase and remove all punctuation/spaces
    text = text.lower().strip()
    text = re.sub(r'[^a-z0-9]', '', text)
    if not text:
        return ""
    # Collapse duplicate characters (e.g. 'kk' -> 'k', 'ee' -> 'e')
    result = [text[0]]
    for char in text[1:]:
        if char != result[-1]:
            result.append(char)
    return "".join(result)

# Register custom SQLite function
conn.create_function("NORMALIZE_SPELLING", 1, normalize_spelling)

def get_road_coordinates(road_name: str) -> tuple[float, float]:
    """Generates realistic Chennai coordinates deterministically based on road name."""
    # Hardcode well-known roads for realistic map scattering
    famous_roads = {
        "rajiv main road": (12.9724, 80.2508),        # OMR area
        "sarabhai junction road": (13.0418, 80.2341), # T.Nagar
        "tagore east coast road": (12.9228, 80.2635), # ECR
        "periyar high road": (13.0827, 80.2707),      # Central
        "t. nagar ring road": (13.0405, 80.2337),     # T.Nagar
        "jayalalithaa avenue": (13.0213, 80.2231),    # Adyar/Guindy
        "arumbakkam canal road": (13.0612, 80.2125),  # Arumbakkam
        "arignar tank road": (13.0338, 80.2121),      # Ashok Nagar
        "nungambakkam loop road": (13.0594, 80.2425), # Nungambakkam
        "annadurai salai": (13.0639, 80.2614),        # Mount Road
        "porur ring road": (13.0382, 80.1554),        # Porur
        "kolathur ring road": (13.1242, 80.2162),     # Kolathur
        "besant canal road": (12.9975, 80.2676),      # Besant Nagar
        "egmore salai": (13.0732, 80.2601),           # Egmore
        "koyambedu street": (13.0692, 80.2049),       # Koyambedu
        "tambaram bypass road": (12.9229, 80.1118),   # Tambaram
        "chromepet service road": (12.9516, 80.1408), # Chromepet
        "guindy avenue": (13.0067, 80.2206),          # Guindy
        "saidapet link road": (13.0224, 80.2274),     # Saidapet
        "velachery service road": (12.9796, 80.2196), # Velachery
        "adyar bridge road": (13.0118, 80.2568),      # Adyar
        "kamarajar loop road": (13.0475, 80.2824),    # Kamarajar Salai (Marina)
    }
    
    normalized = road_name.lower().strip()
    for name, coords in famous_roads.items():
        if name in normalized or normalized in name:
            return coords
            
    # Fallback: Deterministic generation in Chennai bounding box
    # Lat: 12.90 to 13.12, Lng: 80.13 to 80.27
    h = hashlib.md5(road_name.encode('utf-8')).hexdigest()
    val_lat = int(h[0:8], 16) / 0xffffffff
    val_lng = int(h[8:16], 16) / 0xffffffff
    
    lat = 12.90 + val_lat * 0.22
    lng = 80.13 + val_lng * 0.14
    return round(lat, 5), round(lng, 5)

def determine_overall_status(row) -> str:
    """Finds the latest audit status from the three audit columns."""
    for audit_col in ['audit_3_status', 'audit_2_status', 'audit_1_status']:
        val = row.get(audit_col)
        if isinstance(val, str) and val.strip() != "" and val.lower() != 'nan':
            status = val.strip().lower()
            if 'fail' in status:
                return "Failed"
            elif 'conditional' in status or 'warning' in status:
                return "Conditional Pass"
            elif 'pass' in status:
                return "Passed"
    return "Passed" # Default fallback

def init_db():
    """Loads the CSV data and initializes the SQLite tables."""
    print("Initializing Database...")
    
    # Check if files exist
    if not settings.ROADS_CSV.exists():
        raise FileNotFoundError(f"Roads CSV not found at {settings.ROADS_CSV}")
    if not settings.CONTRACTORS_CSV.exists():
        raise FileNotFoundError(f"Contractors CSV not found at {settings.CONTRACTORS_CSV}")
        
    # Read Roads CSV
    roads_df = pd.read_csv(settings.ROADS_CSV)
    
    # Process coordinates and statuses
    coords = [get_road_coordinates(name) for name in roads_df['road_name']]
    roads_df['latitude'] = [c[0] for c in coords]
    roads_df['longitude'] = [c[1] for c in coords]
    roads_df['overall_status'] = roads_df.apply(determine_overall_status, axis=1)
    
    # Replace all NaN values with None (for clean JSON output)
    roads_df = roads_df.where(pd.notnull(roads_df), None)
    
    # Read Contractors CSV
    contractors_df = pd.read_csv(settings.CONTRACTORS_CSV)
    contractors_df = contractors_df.where(pd.notnull(contractors_df), None)
    
    # Load into SQLite
    roads_df.to_sql("roads", conn, if_exists="replace", index=False)
    contractors_df.to_sql("contractors", conn, if_exists="replace", index=False)
    
    print(f"Database initialized. Loaded {len(roads_df)} roads and {len(contractors_df)} contractors.")

def run_query(sql_query: str) -> list[dict] | str:
    """Executes a SQL SELECT query on the in-memory database.
    Returns list of dictionaries containing rows or a string error message.
    """
    # Safety Check
    query_stripped = sql_query.strip().upper()
    # Permit simple SELECT or WITH queries (common for CTEs)
    if not query_stripped.startswith("SELECT") and not query_stripped.startswith("WITH"):
        return "Error: Only SELECT queries are permitted for safety."
        
    try:
        df = pd.read_sql_query(sql_query, conn)
        df = df.where(pd.notnull(df), None)
        return df.to_dict(orient="records")
    except Exception as e:
        return f"SQL Execution Error: {str(e)}"

# Initialize DB at import time
init_db()
