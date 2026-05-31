/* ==========================================================================
   Chennai RoadWatch AI - Application JS Logic
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    // UI Elements
    const landingPage = document.getElementById("landing-page");
    const dashboard = document.getElementById("dashboard");
    const btnLaunch = document.getElementById("btn-launch");
    const btnBack = document.getElementById("btn-back");
    
    const chatLog = document.getElementById("chat-log");
    const chatInput = document.getElementById("chat-input");
    const btnSend = document.getElementById("btn-send");
    const chatLoader = document.getElementById("chat-loader");
    
    // Map & Chat State
    let map = null;
    let markersLayer = null;
    let roadsData = [];
    let chatHistory = [];

    // 1. SPA Navigation Transitions
    btnLaunch.addEventListener("click", () => {
        landingPage.classList.add("hidden");
        dashboard.classList.remove("hidden");
        dashboard.classList.add("active");
        
        // Lazy-initialize Leaflet map on entrance to allow correct container sizing
        setTimeout(() => {
            initMap();
            fetchRoads();
        }, 100);
    });

    btnBack.addEventListener("click", () => {
        dashboard.classList.remove("active");
        dashboard.classList.add("hidden");
        landingPage.classList.remove("hidden");
        
        // Reset chat history and logs for a clean next session
        chatHistory = [];
        const systemMsg = chatLog.querySelector(".message.system");
        chatLog.innerHTML = "";
        if (systemMsg) {
            chatLog.appendChild(systemMsg);
        }
    });

    // 2. Leaflet Map Setup
    function initMap() {
        if (map) {
            map.invalidateSize();
            return;
        }

        // Centered on Chennai District
        map = L.map("map", {
            zoomControl: true,
            scrollWheelZoom: true
        }).setView([13.0475, 80.2337], 11.5);

        // Add standard OSM Tile Layer
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        markersLayer = L.layerGroup().addTo(map);
        
        // Event listener for map popups to capture the "Ask AI" button clicks
        map.on("popupopen", (e) => {
            const popupElement = e.popup.getElement();
            const queryBtn = popupElement.querySelector(".btn-popup-query");
            if (queryBtn) {
                queryBtn.addEventListener("click", () => {
                    const roadName = queryBtn.getAttribute("data-road");
                    submitSuggestedQuery(`Tell me about the audits and budget status for ${roadName}.`);
                    map.closePopup();
                });
            }
        });
    }

    // 3. Fetch Roads from FastAPI
    async function fetchRoads() {
        try {
            const response = await fetch("/api/roads");
            if (!response.ok) throw new Error("Failed to load road data");
            roadsData = await response.json();
            plotRoads(roadsData);
        } catch (error) {
            console.error("Map initialization error:", error);
            // Render basic warning if endpoint is offline
            L.popup()
                .setLatLng([13.0827, 80.2707])
                .setContent("<p style='color:red;'>⚠️ Error connecting to server API to load map markers.</p>")
                .openOn(map);
        }
    }

    // 4. Plot Road Markers with custom color codes
    function plotRoads(roads) {
        if (!markersLayer) return;
        markersLayer.clearLayers();

        roads.forEach((road) => {
            if (!road.latitude || !road.longitude) return;

            let color = "#4CAF50"; // Passed (default)
            let statusClass = "passed";
            
            if (road.overall_status === "Failed") {
                color = "#C62828";
                statusClass = "failed";
            } else if (road.overall_status === "Conditional Pass") {
                color = "#EF6C00";
                statusClass = "warning";
            }

            // Create a clean, modern circle marker
            const marker = L.circleMarker([road.latitude, road.longitude], {
                radius: 7,
                fillColor: color,
                color: "#FFFFFF",
                weight: 1.5,
                opacity: 1,
                fillOpacity: 0.85
            });

            // Budget format
            const formattedBudget = formatCurrency(road.allotted_budget_inr);
            const formattedUsed = formatCurrency(road.amount_used_inr);
            const budgetOverrun = road.amount_used_inr > road.allotted_budget_inr 
                ? `<span style="color:var(--status-failed); font-weight:700;">Overrun (+${formatCurrency(road.amount_used_inr - road.allotted_budget_inr)})</span>` 
                : '<span style="color:var(--status-passed)">Within Budget</span>';

            // Popup Layout
            const popupContent = `
                <div class="map-popup-card">
                    <h3>${road.road_name}</h3>
                    <p><strong>Contractor:</strong> ${road.contractor_name}</p>
                    <p><strong>Budget:</strong> ${formattedBudget}</p>
                    <p><strong>Amount Spent:</strong> ${formattedUsed}</p>
                    <p><strong>Status:</strong> ${budgetOverrun}</p>
                    <div>
                        <span class="popup-status-badge ${statusClass}">${road.overall_status}</span>
                    </div>
                    <button class="btn-popup-query" data-road="${road.road_name}">
                        <i class="fa-solid fa-robot"></i> Ask AI about this road
                    </button>
                </div>
            `;

            marker.bindPopup(popupContent);
            markersLayer.addLayer(marker);
        });
    }

    // Helper to format large INR values
    function formatCurrency(value) {
        if (value === null || value === undefined) return "N/A";
        
        // If >= 1 Crore (10,000,000)
        if (value >= 10000000) {
            return `₹${(value / 10000000).toFixed(2)} Crore`;
        }
        // If >= 1 Lakh (100,000)
        if (value >= 100000) {
            return `₹${(value / 100000).toFixed(2)} Lakh`;
        }
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
    }

    // 5. Chat Interaction Logic
    async function sendMessage(text) {
        if (!text || text.trim() === "") return;
        
        // Push user message to state history
        chatHistory.push({ role: "user", content: text });
        
        // Render User message
        appendMessage(text, "user");
        chatInput.value = "";
        adjustTextareaHeight();
        
        // Show Loading state
        chatLoader.classList.remove("hidden");
        btnSend.disabled = true;

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: chatHistory })
            });

            if (!response.ok) throw new Error("Server communication issue");

            const data = await response.json();
            
            // Push bot response to state history
            chatHistory.push({ role: "assistant", content: data.answer });
            
            // Render Bot response
            appendMessage(data.answer, "bot", data.sql_query);
        } catch (error) {
            console.error("Chat error:", error);
            appendMessage("⚠️ **Connection Error**: I could not reach the server API. Please ensure the Python server is running locally.", "bot");
            // Remove the failed user message from history
            chatHistory.pop();
        } finally {
            chatLoader.classList.add("hidden");
            btnSend.disabled = false;
        }
    }

    function appendMessage(text, sender, sqlQuery = null) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${sender}`;
        
        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";
        contentDiv.innerHTML = formatMarkdown(text);
        
        // Append SQL query details if provided (for debugging and transparency)
        if (sqlQuery) {
            const sqlDetails = document.createElement("details");
            sqlDetails.className = "sql-details";
            sqlDetails.innerHTML = `
                <summary><i class="fa-solid fa-code"></i> Executed SQL Query</summary>
                <pre><code>${sqlQuery}</code></pre>
            `;
            contentDiv.appendChild(sqlDetails);
        }

        msgDiv.appendChild(contentDiv);
        chatLog.appendChild(msgDiv);
        
        // Scroll to bottom
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    function submitSuggestedQuery(text) {
        sendMessage(text);
    }

    // Listeners for Suggested Queries
    chatLog.addEventListener("click", (e) => {
        if (e.target.classList.contains("suggested-query")) {
            e.preventDefault();
            submitSuggestedQuery(e.target.textContent);
        }
    });

    btnSend.addEventListener("click", () => {
        sendMessage(chatInput.value);
    });

    chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage(chatInput.value);
        }
    });

    // Auto-expanding chat textarea
    chatInput.addEventListener("input", adjustTextareaHeight);
    
    function adjustTextareaHeight() {
        chatInput.style.height = "auto";
        chatInput.style.height = (chatInput.scrollHeight - 4) + "px";
    }

    // 6. Markdown Formatter Utility
    function formatMarkdown(text) {
        if (!text) return "";

        // Standard HTML sanitization
        let formatted = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // Bold: **text** -> <strong>text</strong>
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

        // Inline Code: `code` -> <code>code</code>
        formatted = formatted.replace(/`(.*?)`/g, "<code>$1</code>");

        // Format Bulleted Lists (- or *)
        const lines = formatted.split("\n");
        let htmlResult = "";
        let inList = false;

        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                if (!inList) {
                    htmlResult += "<ul>";
                    inList = true;
                }
                htmlResult += `<li>${trimmed.substring(2)}</li>`;
            } else {
                if (inList) {
                    htmlResult += "</ul>";
                    inList = false;
                }
                
                // If it's a headers/titles (like ### Header)
                if (trimmed.startsWith("### ")) {
                    htmlResult += `<h3>${trimmed.substring(4)}</h3>`;
                } else if (trimmed.startsWith("## ")) {
                    htmlResult += `<h2>${trimmed.substring(3)}</h2>`;
                } else if (trimmed.startsWith("# ")) {
                    htmlResult += `<h1>${trimmed.substring(2)}</h1>`;
                } else if (trimmed !== "") {
                    htmlResult += `<p>${line}</p>`;
                }
            }
        });

        if (inList) {
            htmlResult += "</ul>";
        }

        // Clean double spaces/newlines
        return htmlResult.replace(/<p><\/p>/g, "");
    }
});
