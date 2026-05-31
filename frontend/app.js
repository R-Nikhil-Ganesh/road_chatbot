/* ==========================================================================
   Chennai RoadWatch AI - Application JS Logic
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    // UI Navigation Elements
    const landingPage = document.getElementById("landing-page");
    const dashboard = document.getElementById("dashboard");
    const btnLaunch = document.getElementById("btn-launch");
    const btnBack = document.getElementById("btn-back");
    
    // Tab Elements
    const tabDashboard = document.getElementById("tab-dashboard");
    const tabComplaints = document.getElementById("tab-complaints");
    const tabDashboardView = document.getElementById("tab-dashboard-view");
    const tabComplaintsView = document.getElementById("tab-complaints-view");
    
    // Chat Elements
    const chatLog = document.getElementById("chat-log");
    const chatInput = document.getElementById("chat-input");
    const btnSend = document.getElementById("btn-send");
    const chatLoader = document.getElementById("chat-loader");
    
    // Complaints Form Elements
    const compRoadSelect = document.getElementById("comp-road-select");
    const compContractor = document.getElementById("comp-contractor");
    const compCategory = document.getElementById("comp-category");
    const formComplaint = document.getElementById("form-complaint");
    const complaintsLogList = document.getElementById("complaints-log-list");
    const routingPreviewContent = document.getElementById("routing-preview-content");
    
    // Modal Elements
    const dossierModal = document.getElementById("dossier-modal");
    const btnCloseModal = document.getElementById("btn-close-modal");
    const btnCopyModalLetter = document.getElementById("btn-copy-modal-letter");
    const btnSendModalEmail = document.getElementById("btn-send-modal-email");
    const btnDownloadModalDossier = document.getElementById("btn-download-modal-dossier");
    const modalLetterText = document.getElementById("modal-letter-text");
    const modalTicketId = document.getElementById("modal-ticket-id");
    const modalStatusBadge = document.getElementById("modal-status-badge");
    const modalAgency = document.getElementById("modal-agency");
    const modalOfficer = document.getElementById("modal-officer");
    const modalEmail = document.getElementById("modal-email");
    const modalContractor = document.getElementById("modal-contractor");
    
    // State
    let map = null;
    let markersLayer = null;
    let roadsData = [];
    let chatHistory = [];
    let activeComplaints = [];
    let complaintMarkers = [];

    // 1. SPA Navigation & Transitions
    btnLaunch.addEventListener("click", () => {
        landingPage.classList.add("hidden");
        dashboard.classList.remove("hidden");
        dashboard.classList.add("active");
        
        // Lazy-initialize portal map and fetch data
        setTimeout(() => {
            initMap();
            fetchRoads();
            fetchComplaints();
        }, 100);
    });

    btnBack.addEventListener("click", () => {
        dashboard.classList.remove("active");
        dashboard.classList.add("hidden");
        landingPage.classList.remove("hidden");
        
        // Reset chat history and log elements for a clean next session
        chatHistory = [];
        const systemMsg = chatLog.querySelector(".message.system");
        chatLog.innerHTML = "";
        if (systemMsg) {
            chatLog.appendChild(systemMsg);
        }
        
        // Switch back to dashboard view default
        switchTab("tab-dashboard");
    });

    // 2. Tab Navigation controls
    tabDashboard.addEventListener("click", () => switchTab("tab-dashboard"));
    tabComplaints.addEventListener("click", () => {
        switchTab("tab-complaints");
        fetchComplaints(); // Reload complaints logs
    });

    function switchTab(activeTabId) {
        if (activeTabId === "tab-dashboard") {
            tabDashboard.classList.add("active");
            tabComplaints.classList.remove("active");
            tabDashboardView.classList.add("active");
            tabComplaintsView.classList.remove("active");
            // Map sizing recalculation in case it was hidden
            if (map) {
                setTimeout(() => map.invalidateSize(), 50);
            }
        } else {
            tabComplaints.classList.add("active");
            tabDashboard.classList.remove("active");
            tabComplaintsView.classList.add("active");
            tabDashboardView.classList.remove("active");
        }
    }

    // 3. Leaflet Map Setup
    function initMap() {
        if (map) {
            map.invalidateSize();
            return;
        }

        // Center on Chennai District
        map = L.map("map", {
            zoomControl: true,
            scrollWheelZoom: true
        }).setView([13.0475, 80.2337], 11.5);

        // Add standard grayscaled OSM Tile Layer
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        markersLayer = L.layerGroup().addTo(map);
        
        // Popup trigger Ask AI query
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

    // 4. Fetch Roads from FastAPI
    async function fetchRoads() {
        try {
            const response = await fetch("/api/roads");
            if (!response.ok) throw new Error("Failed to load road data");
            roadsData = await response.json();
            plotRoads(roadsData);
            populateRoadsDropdown(roadsData);
        } catch (error) {
            console.error("Map initialization error:", error);
            if (map) {
                L.popup()
                    .setLatLng([13.0827, 80.2707])
                    .setContent("<p style='color:red;'>⚠️ Error connecting to server API to load map markers.</p>")
                    .openOn(map);
            }
        }
    }

    // 5. Plot Road Markers
    function plotRoads(roads) {
        if (!markersLayer) return;
        markersLayer.clearLayers();

        roads.forEach((road) => {
            if (!road.latitude || !road.longitude) return;

            let color = "#4CAF50"; // Passed
            let statusClass = "passed";
            
            if (road.overall_status === "Failed") {
                color = "#C62828";
                statusClass = "failed";
            } else if (road.overall_status === "Conditional Pass") {
                color = "#EF6C00";
                statusClass = "warning";
            }

            const marker = L.circleMarker([road.latitude, road.longitude], {
                radius: 7,
                fillColor: color,
                color: "#FFFFFF",
                weight: 1.5,
                opacity: 1,
                fillOpacity: 0.85
            });

            const formattedBudget = formatCurrency(road.allotted_budget_inr);
            const formattedUsed = formatCurrency(road.amount_used_inr);
            const budgetOverrun = road.amount_used_inr > road.allotted_budget_inr 
                ? `<span style="color:var(--status-failed); font-weight:700;">Overrun (+${formatCurrency(road.amount_used_inr - road.allotted_budget_inr)})</span>` 
                : '<span style="color:var(--status-passed)">Within Budget</span>';

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

    // Helper Currency Formatter
    function formatCurrency(value) {
        if (value === null || value === undefined) return "N/A";
        if (value >= 10000000) {
            return `₹${(value / 10000000).toFixed(2)} Crore`;
        }
        if (value >= 100000) {
            return `₹${(value / 100000).toFixed(2)} Lakh`;
        }
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
    }

    // 6. Populate Roads Dropdown Form
    function populateRoadsDropdown(roads) {
        if (!compRoadSelect) return;
        compRoadSelect.innerHTML = '<option value="" disabled selected>Choose a road in Chennai...</option>';
        
        // Sort roads alphabetically
        const sortedRoads = [...roads].sort((a, b) => a.road_name.localeCompare(b.road_name));
        sortedRoads.forEach(road => {
            const opt = document.createElement("option");
            opt.value = road.road_name;
            opt.textContent = road.road_name;
            compRoadSelect.appendChild(opt);
        });
    }

    // Auto-match Contractor on select change and refresh live directory lookup
    compRoadSelect.addEventListener("change", (e) => {
        const roadName = e.target.value;
        const matchedRoad = roadsData.find(r => r.road_name === roadName);
        if (matchedRoad) {
            compContractor.value = matchedRoad.contractor_name;
        } else {
            compContractor.value = "";
        }
        updateRoutingPreview();
    });

    compCategory.addEventListener("change", () => {
        updateRoutingPreview();
    });

    async function updateRoutingPreview() {
        const roadName = compRoadSelect.value;
        const category = compCategory.value;
        
        if (!roadName || !category) {
            routingPreviewContent.innerHTML = `
                <div class="empty-preview-message">
                    <i class="fa-solid fa-circle-nodes"></i>
                    <p>Select a road and complaint category to see who to complain to and get a pre-drafted grievance letter.</p>
                </div>
            `;
            return;
        }
        
        routingPreviewContent.innerHTML = `
            <div class="empty-preview-message">
                <i class="fa-solid fa-spinner fa-spin" style="color:var(--accent);"></i>
                <p>Querying grievance directory...</p>
            </div>
        `;
        
        try {
            const url = `/api/routing-lookup?road_name=${encodeURIComponent(roadName)}&category=${encodeURIComponent(category)}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error("Grievance lookup failed");
            
            const routing = await response.json();
            
            let blacklistAlertHtml = "";
            if (routing.is_blacklisted) {
                blacklistAlertHtml = `
                    <div class="blacklist-alert-banner" style="margin: 4px 0 0 0;">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <span>Contractor Blacklisted: Escalated to Special Audit Cell</span>
                    </div>
                `;
            }
            
            routingPreviewContent.innerHTML = `
                <div class="routing-preview-card">
                    <div class="routing-agency-header">
                        <i class="fa-solid fa-building-shield"></i>
                        <div>
                            <h3>Grievance Routing Details</h3>
                            <p>Immediate Public Escalation Assignment</p>
                        </div>
                    </div>
                    
                    <table class="modal-routing-table" style="margin:0;">
                        <tr>
                            <th>Routed Agency</th>
                            <td>${routing.routed_department}</td>
                        </tr>
                        <tr>
                            <th>Escalation Officer</th>
                            <td>${routing.routing_officer}</td>
                        </tr>
                        <tr>
                            <th>Contact Email</th>
                            <td>${routing.contact_email}</td>
                        </tr>
                        <tr>
                            <th>Responsible Contractor</th>
                            <td>${routing.contractor_name} (${routing.blacklist_status})</td>
                        </tr>
                    </table>
                    
                    ${blacklistAlertHtml}
                    
                    <div class="dossier-preview-letter">
                        <div class="dossier-letter-header">
                            <span><i class="fa-regular fa-file-lines"></i> Grievance Letter Draft</span>
                            <button type="button" id="btn-copy-preview-letter" class="btn-copy-small" title="Copy letter text">
                                <i class="fa-solid fa-copy"></i> Copy
                            </button>
                        </div>
                        <pre class="letter-pre-text" id="preview-letter-pre">${routing.draft_letter}</pre>
                    </div>
                    
                    <div class="preview-actions" style="display: flex; gap: 10px;">
                        <button type="button" id="btn-download-preview-dossier" class="btn-secondary" style="flex: 1; justify-content: center;">
                            Download Dossier <i class="fa-solid fa-download"></i>
                        </button>
                        <a href="mailto:${routing.contact_email}?subject=${encodeURIComponent(routing.subject)}&body=${encodeURIComponent(routing.draft_letter)}" class="btn-primary btn-mailto-trigger" target="_blank" style="flex: 1; justify-content: center; text-decoration: none;">
                            Send Email Direct <i class="fa-solid fa-envelope"></i>
                        </a>
                    </div>
                </div>
            `;
            
            // Copy button listener
            const copyBtn = document.getElementById("btn-copy-preview-letter");
            if (copyBtn) {
                copyBtn.addEventListener("click", () => {
                    navigator.clipboard.writeText(routing.draft_letter)
                        .then(() => {
                            copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
                            setTimeout(() => {
                                copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy';
                            }, 2000);
                        })
                        .catch(err => console.error("Clipboard copy failed", err));
                });
            }
            
            // Download button listener
            const downloadPreviewBtn = document.getElementById("btn-download-preview-dossier");
            if (downloadPreviewBtn) {
                downloadPreviewBtn.addEventListener("click", () => {
                    downloadGrievanceDossier({
                        road_name: roadName,
                        contractor_name: routing.contractor_name,
                        blacklist_status: routing.blacklist_status,
                        routed_department: routing.routed_department,
                        routing_officer: routing.routing_officer,
                        contact_email: routing.contact_email,
                        draft_letter: routing.draft_letter
                    });
                });
            }
            
        } catch (err) {
            console.error("Preview error:", err);
            routingPreviewContent.innerHTML = `
                <div class="empty-preview-message" style="color:var(--status-failed);">
                    <i class="fa-solid fa-circle-exclamation"></i>
                    <p>Failed to retrieve routing details.</p>
                </div>
            `;
        }
    }

    // 7. Submit Complaint
    formComplaint.addEventListener("submit", async (e) => {
        e.preventDefault();
        const roadName = compRoadSelect.value;
        const contractorName = compContractor.value;
        const category = compCategory.value;
        const severity = document.getElementById("comp-severity").value;
        const description = document.getElementById("comp-description").value;
        const submitBtn = document.getElementById("btn-submit-complaint");

        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Filing Grievance... <i class="fa-solid fa-spinner fa-spin"></i>';

        try {
            const response = await fetch("/api/complaints", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    road_name: roadName,
                    contractor_name: contractorName,
                    category: category,
                    severity: severity,
                    description: description
                })
            });

            if (!response.ok) throw new Error("Filing complaint failed");

            const ticket = await response.json();

            // Populate and show the modal
            modalTicketId.textContent = ticket.complaint_id;
            modalStatusBadge.textContent = ticket.status;
            
            // Adjust status badge color class
            modalStatusBadge.className = "status-badge";
            let statusClass = "assigned";
            if (ticket.status.includes("Investigation")) statusClass = "investigation";
            else if (ticket.status.includes("Escalated")) statusClass = "escalated";
            modalStatusBadge.classList.add(statusClass);

            modalAgency.textContent = ticket.routed_department;
            modalOfficer.textContent = ticket.routing_officer;
            modalEmail.textContent = ticket.contact_email;
            modalContractor.textContent = ticket.contractor_name;
            
            // Inject the citizen description into the draft letter dynamically
            let fullLetter = ticket.draft_letter.replace("[Provide specific landmarks, impact on local traffic, and photos/videos if available]", description);
            modalLetterText.value = fullLetter;
            
            // Setup mailto button
            btnSendModalEmail.href = `mailto:${ticket.contact_email}?subject=${encodeURIComponent(ticket.subject)}&body=${encodeURIComponent(fullLetter)}`;
            
            // Handle copy action for modal button
            btnCopyModalLetter.onclick = () => {
                navigator.clipboard.writeText(fullLetter)
                    .then(() => {
                        btnCopyModalLetter.innerHTML = 'Copied Letter! <i class="fa-solid fa-check"></i>';
                        setTimeout(() => {
                            btnCopyModalLetter.innerHTML = 'Copy Letter <i class="fa-solid fa-copy"></i>';
                        }, 2000);
                    })
                    .catch(err => console.error("Clipboard copy failed", err));
            };

            // Handle download action for modal button
            btnDownloadModalDossier.onclick = () => {
                downloadGrievanceDossier({
                    ticket_id: ticket.complaint_id,
                    road_name: roadName,
                    contractor_name: ticket.contractor_name,
                    blacklist_status: ticket.blacklist_alert ? "Blacklisted" : "Active - Clean Record",
                    routed_department: ticket.routed_department,
                    routing_officer: ticket.routing_officer,
                    contact_email: ticket.contact_email,
                    draft_letter: fullLetter
                });
            };

            // Open Modal
            dossierModal.classList.remove("hidden");

            // Reset description and selects
            document.getElementById("comp-description").value = "";
            compRoadSelect.value = "";
            compContractor.value = "";
            compCategory.value = "";

            updateRoutingPreview(); // Reset preview pane
            await fetchComplaints(); // Refresh complaints view
            
        } catch (err) {
            console.error("Submit error:", err);
            alert("Failed to submit grievance. Verify API connectivity.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'File Grievance & Route Ticket <i class="fa-solid fa-paper-plane"></i>';
        }
    });

    // Close Modal Event Listeners
    btnCloseModal.addEventListener("click", () => {
        dossierModal.classList.add("hidden");
    });

    dossierModal.addEventListener("click", (e) => {
        if (e.target === dossierModal) {
            dossierModal.classList.add("hidden");
        }
    });

    // 8. Fetch & Render Complaints
    async function fetchComplaints() {
        try {
            const response = await fetch("/api/complaints");
            if (!response.ok) throw new Error("Could not fetch complaints list");
            activeComplaints = await response.json();
            renderComplaints(activeComplaints);
            plotComplaintMarkers(activeComplaints);
        } catch (error) {
            console.error("Complaints loading error:", error);
        }
    }

    function renderComplaints(complaints) {
        if (!complaintsLogList) return;
        complaintsLogList.innerHTML = "";

        if (complaints.length === 0) {
            complaintsLogList.innerHTML = "<p style='color:var(--secondary); text-align:center; padding:40px 0;'>No active citizen tickets recorded.</p>";
            return;
        }

        complaints.forEach(comp => {
            const card = document.createElement("div");
            card.className = "complaint-card";

            const sevClass = comp.severity.toLowerCase();
            let statusClass = "assigned";
            if (comp.status.includes("Investigation")) statusClass = "investigation";
            else if (comp.status.includes("Escalated")) statusClass = "escalated";

            // If routed PWD Special Investigation Cell, show warnings
            const isEscalated = comp.status.includes("Escalated");
            const blacklistBanner = isEscalated
                ? `<div class="blacklist-alert-banner">
                     <i class="fa-solid fa-triangle-exclamation"></i>
                     <span>Contractor Blacklisted: Escalated to Special Audit Division</span>
                   </div>`
                : "";

            card.innerHTML = `
                <div class="complaint-card-header">
                    <span class="ticket-id"><i class="fa-solid fa-circle-exclamation" style="color:var(--status-failed);"></i> ${comp.complaint_id}</span>
                    <div>
                        <span class="severity-pill ${sevClass}">${comp.severity} Severity</span>
                        <span class="status-badge ${statusClass}">${comp.status}</span>
                    </div>
                </div>
                <div class="complaint-details">
                    <h3>${comp.road_name}</h3>
                    <div class="comp-contractor-tag">Assigned Contractor: <strong>${comp.contractor_name}</strong></div>
                    <p>"${comp.description}"</p>
                </div>
                <div class="routing-slip">
                    <div class="routing-slip-title"><i class="fa-solid fa-route"></i> Official Department Routing Slip</div>
                    <div>Routed Agency: <strong>${comp.routed_department}</strong></div>
                    <div>Escalation Officer: <strong>${comp.routing_officer}</strong></div>
                    <div>Department Contact: <strong>${comp.contact_email}</strong></div>
                    <div>File Datetime: <strong>${comp.created_at}</strong></div>
                    ${blacklistBanner}
                </div>
            `;
            complaintsLogList.appendChild(card);
        });
    }

    // 9. Plot Complaint Exclamation Warnings on Map
    function plotComplaintMarkers(complaints) {
        // Clear previous markers
        complaintMarkers.forEach(m => map.removeLayer(m));
        complaintMarkers = [];

        if (!map) return;

        complaints.forEach(comp => {
            // Find parent road coordinates
            const road = roadsData.find(r => r.road_name === comp.road_name);
            if (!road || !road.latitude || !road.longitude) return;

            // Make warning icon div element
            const warningIcon = L.divIcon({
                className: "complaint-map-marker",
                html: `<div class="complaint-marker-icon" title="Complaint ${comp.complaint_id}"><i class="fa-solid fa-triangle-exclamation"></i></div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });

            const marker = L.marker([road.latitude, road.longitude], { icon: warningIcon });
            
            const popupContent = `
                <div class="map-popup-card" style="max-width:260px;">
                    <h3 style="color:var(--status-failed); display:flex; align-items:center; gap:6px;">
                        <i class="fa-solid fa-triangle-exclamation"></i> Active Citizen Complaint
                    </h3>
                    <p><strong>Ticket:</strong> ${comp.complaint_id}</p>
                    <p><strong>Road:</strong> ${comp.road_name}</p>
                    <p><strong>Category:</strong> ${comp.category}</p>
                    <p><strong>Severity:</strong> ${comp.severity}</p>
                    <p style="background:var(--bg); border:1px solid var(--border); padding:8px; border-radius:6px; font-size:0.85rem; margin:8px 0;">"${comp.description}"</p>
                    <p><strong>Routed To:</strong> ${comp.routed_department}</p>
                </div>
            `;

            marker.bindPopup(popupContent);
            marker.addTo(map);
            complaintMarkers.push(marker);
        });
    }

    // 10. Chat Logic
    async function sendMessage(text) {
        if (!text || text.trim() === "") return;
        
        chatHistory.push({ role: "user", content: text });
        appendMessage(text, "user");
        chatInput.value = "";
        adjustTextareaHeight();
        
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
            chatHistory.push({ role: "assistant", content: data.answer });
            appendMessage(data.answer, "bot");
        } catch (error) {
            console.error("Chat error:", error);
            appendMessage("⚠️ **Connection Error**: I could not reach the server API. Please ensure the Python server is running locally.", "bot");
            chatHistory.pop();
        } finally {
            chatLoader.classList.add("hidden");
            btnSend.disabled = false;
        }
    }
 
    function appendMessage(text, sender) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${sender}`;
        
        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";
        contentDiv.innerHTML = formatMarkdown(text);
 
        msgDiv.appendChild(contentDiv);
        chatLog.appendChild(msgDiv);
        chatLog.scrollTop = chatLog.scrollHeight;
    }
 
    function submitSuggestedQuery(text) {
        sendMessage(text);
    }
 
    chatLog.addEventListener("click", (e) => {
        if (e.target.classList.contains("suggested-query")) {
            e.preventDefault();
            submitSuggestedQuery(e.target.textContent);
        }
        
        const downloadBtn = e.target.closest(".btn-download-table-csv");
        if (downloadBtn) {
            e.preventDefault();
            const tableId = downloadBtn.getAttribute("data-table-id");
            downloadTableAsCSV(tableId);
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
 
    chatInput.addEventListener("input", adjustTextareaHeight);
    
    function adjustTextareaHeight() {
        chatInput.style.height = "auto";
        chatInput.style.height = (chatInput.scrollHeight - 4) + "px";
    }
 
    // Helper function to render table HTML
    function renderHtmlTable(headers, rows) {
        if (!headers || headers.length === 0) return "";
        
        const tableId = "table-" + Math.random().toString(36).substring(2, 9);
        
        let headerHtml = headers.map(h => `<th>${h}</th>`).join("");
        let rowsHtml = rows.map(row => {
            while (row.length < headers.length) row.push("");
            return `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`;
        }).join("");
        
        return `
            <div class="table-container-wrapper" id="container-${tableId}">
                <div class="table-actions-header">
                    <button type="button" class="btn-download-table-csv" data-table-id="${tableId}" title="Download table as CSV">
                        <i class="fa-solid fa-download"></i> Download CSV
                    </button>
                </div>
                <div class="table-responsive">
                    <table class="agent-data-table" id="${tableId}">
                        <thead>
                            <tr>${headerHtml}</tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // CSV table downloader
    function downloadTableAsCSV(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;
        
        let csvContent = "";
        
        const headers = Array.from(table.querySelectorAll("thead th")).map(th => th.textContent.trim());
        csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";
        
        const rows = Array.from(table.querySelectorAll("tbody tr"));
        rows.forEach(tr => {
            const cells = Array.from(tr.querySelectorAll("td")).map(td => td.textContent.trim());
            csvContent += cells.map(c => `"${c.replace(/"/g, '""')}"`).join(",") + "\n";
        });
        
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `roadwatch-data-${tableId}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Grievance Dossier Text Downloader
    function downloadGrievanceDossier(data) {
        let content = `======================================================\n`;
        content += `CHENNAI ROADWATCH AI - OFFICIAL GRIEVANCE DOSSIER\n`;
        if (data.ticket_id) {
            content += `Ticket ID: ${data.ticket_id}\n`;
        }
        content += `Date Generated: ${new Date().toLocaleString()}\n`;
        content += `======================================================\n\n`;
        
        content += `ROAD INFRASTRUCTURE DETAILS:\n`;
        content += `- Road Name: ${data.road_name}\n`;
        content += `- Responsible Contractor: ${data.contractor_name}\n`;
        content += `- Contractor Status: ${data.blacklist_status}\n\n`;
        
        content += `OFFICIAL GRIVANCE ROUTING ESCALATION:\n`;
        content += `- Assigned Department: ${data.routed_department}\n`;
        content += `- Escalation Officer: ${data.routing_officer}\n`;
        content += `- Department Email: ${data.contact_email}\n\n`;
        
        content += `======================================================\n`;
        content += `PRE-DRAFTED OFFICIAL GRIEVANCE LETTER:\n`;
        content += `======================================================\n\n`;
        content += data.draft_letter;
        
        const blob = new Blob([content], { type: "text/plain;charset=utf-8;" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        const filename = data.ticket_id ? `grievance-dossier-${data.ticket_id}.txt` : `grievance-lookup-${data.road_name.replace(/\s+/g, "_")}.txt`;
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Markdown Formatter Utility (with Table parser)
    function formatMarkdown(text) {
        if (!text) return "";

        let formatted = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
        formatted = formatted.replace(/`(.*?)`/g, "<code>$1</code>");

        const lines = formatted.split("\n");
        let htmlResult = "";
        let inList = false;
        let inTable = false;
        let tableHeaders = [];
        let tableRows = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
                if (inList) {
                    htmlResult += "</ul>";
                    inList = false;
                }

                const isSeparator = /^\|[\s\-\|:]+\|$/.test(trimmed);
                if (isSeparator) {
                    continue; 
                }

                const cols = line.split("|")
                    .map(c => c.trim())
                    .filter((c, idx, arr) => idx > 0 && idx < arr.length - 1); 

                if (!inTable) {
                    inTable = true;
                    tableHeaders = cols;
                } else {
                    tableRows.push(cols);
                }
                continue;
            } else {
                if (inTable) {
                    htmlResult += renderHtmlTable(tableHeaders, tableRows);
                    inTable = false;
                    tableHeaders = [];
                    tableRows = [];
                }
            }

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
        }

        if (inTable) {
            htmlResult += renderHtmlTable(tableHeaders, tableRows);
        }
        if (inList) {
            htmlResult += "</ul>";
        }

        return htmlResult.replace(/<p><\/p>/g, "");
    }
});
