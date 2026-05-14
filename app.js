(function (global) {
  "use strict";

  var APP = {};

  APP.MODES = [
    {
      id: "deplete",
      title: "How long will it take to deplete my sample?",
      description: "Highlights the settings needed to estimate sample depletion time.",
      requiredKeys: ["flowRate", "initialSampleVolumeUl"],
      primaryResult: "timeToSampleDepletionSeconds"
    },
    {
      id: "targetCells",
      title: "How long will it take to get a certain number of cells?",
      description: "Focuses on sort efficiency, sort rate, and time to target cell count.",
      requiredKeys: ["precisionMode", "nozzle", "expectedEventRate", "targetFrequencyPercent", "desiredSortedCells"],
      primaryResult: "timeToTargetCellsSeconds"
    },
    {
      id: "tubeCapacity",
      title: "How many cells can I fit in my collection tube?",
      description: "Uses droplet volume and vessel capacity to estimate tube limits.",
      requiredKeys: ["precisionMode", "nozzle", "initialCollectionMediaUl", "collectionVessel"],
      primaryResult: "maxSortedCellsPerTube"
    },
    {
      id: "eventRate",
      title: "What will my event rate be?",
      description: "Estimates event rate from concentration and flow rate.",
      requiredKeys: ["flowRate", "sampleConcentrationCellsPerMl"],
      primaryResult: "eventRateFromConcentration"
    }
  ];

  APP.PRECISION_MODE_INFO = {
    "4-way Purity": {
      sortEfficiencyMaskDrops: 2,
      volumeMaskDrops: 1,
      description: "Droplets containing target cells with no nearby non-target cells are sorted. Moderate recovery with high purity. Used for 4-way and plate sorting."
    },
    "Purity": {
      sortEfficiencyMaskDrops: 2,
      volumeMaskDrops: 2,
      description: "Droplets containing target cells with no nearby non-target cells are sorted. Moderate recovery with high purity."
    },
    "Yield": {
      sortEfficiencyMaskDrops: 0,
      volumeMaskDrops: 2,
      description: "All droplets containing target cells are sorted. Non-target cells are not considered. High recovery with relatively low purity."
    },
    "Single Cell": {
      sortEfficiencyMaskDrops: null,
      volumeMaskDrops: 1,
      description: "Droplets containing single target cells centered in the droplet with no nearby non-target cells are sorted. Low recovery with high purity for single-cell sorting. Sort-efficiency-derived outputs are unavailable."
    }
  };

  APP.NOZZLES = {
    "70um": { frequencyKhz: 87, dropletVolumeNl: 1.1 },
    "85um": { frequencyKhz: 47, dropletVolumeNl: 2.34 },
    "100um": { frequencyKhz: 30, dropletVolumeNl: 3.2 },
    "130um": { frequencyKhz: 12, dropletVolumeNl: 6.5 }
  };

  APP.COLLECTION_VESSELS = {
    "5mL FACS Tubes": 5000,
    "1.5mL Eppendorf": 1500,
    "15 mL Falcon": 15000,
    "50 mL Falcon": 50000
  };

  APP.FLOW_RATE_EQUATION = {
    m: 0.1428,
    b: 0.2447
  };

  APP.DEFAULT_STATE = {
    mode: "targetCells",
    precisionMode: "4-way Purity",
    nozzle: "85um",
    flowRate: "",
    initialSampleVolumeUl: "",
    initialCollectionMediaUl: "",
    sampleConcentrationCellsPerMl: "",
    collectionVessel: "5mL FACS Tubes",
    expectedEventRate: "",
    targetFrequencyPercent: "",
    desiredSortedCells: ""
  };

  APP.RESULT_DEFS = [
    {
      key: "timeToSampleDepletionSeconds",
      label: "Time to Sample Depletion",
      unit: "h:mm:ss",
      description: "Minimum time before the loaded sample is exhausted at the current flow rate.",
      formatter: formatDuration
    },
    {
      key: "timeToTargetCellsSeconds",
      label: "Time to Sort Target Cell Number",
      unit: "h:mm:ss",
      description: "Minimum active sort time needed to collect the requested target cells.",
      formatter: formatDuration
    },
    {
      key: "maxSortedCellsPerTube",
      label: "Maximum Sorted Cells per Tube",
      unit: "cells",
      description: "Estimated maximum cells that fit in the collection vessel after accounting for media volume.",
      formatter: function (value) { return formatNumber(value, 0); }
    },
    {
      key: "eventRateFromConcentration",
      label: "Estimated Event Rate",
      unit: "evt/s",
      description: "Approximate event rate at the selected flow rate and sample concentration.",
      formatter: function (value) { return formatNumber(value, 2); }
    },
    {
      key: "sortRate",
      label: "Sort Rate",
      unit: "evt/s",
      description: "Estimated number of target cells sorted per second.",
      formatter: function (value) { return formatNumber(value, 2); }
    },
    {
      key: "sortEfficiencyPercent",
      label: "Sort Efficiency",
      unit: "%",
      description: "Percentage of selected target cells expected to be sorted.",
      formatter: function (value) { return formatNumber(value, 2); }
    },
    {
      key: "targetEventRate",
      label: "Event Rate of Target Cells",
      unit: "evt/s",
      description: "Target population event rate derived from total event rate and frequency.",
      formatter: function (value) { return formatNumber(value, 2); }
    },
    {
      key: "dropletVolumeNl",
      label: "Droplet Volume",
      unit: "nL",
      description: "Droplet volume for the selected nozzle.",
      formatter: function (value) { return formatNumber(value, 2); }
    },
    {
      key: "flowRateUlPerSec",
      label: "Flow Rate",
      unit: "uL/s",
      description: "Estimated true flow rate for the selected flow setting.",
      formatter: function (value) { return formatNumber(value, 4); }
    },
    {
      key: "volumePerSortedCellNl",
      label: "Volume per Sorted Cell",
      unit: "nL",
      description: "Estimated collection volume consumed per sorted cell.",
      formatter: function (value) { return formatNumber(value, 2); }
    }
  ];

  APP.createInitialState = function () {
    return clone(APP.DEFAULT_STATE);
  };

  APP.calculateResults = function (state) {
    var statusMessages = [];
    var warningMessages = [];
    var errors = [];
    var nozzleInfo = APP.NOZZLES[state.nozzle] || null;
    var precisionInfo = APP.PRECISION_MODE_INFO[state.precisionMode] || null;
    var vesselMaxVolume = APP.COLLECTION_VESSELS[state.collectionVessel];

    var flowRate = toNumberOrNull(state.flowRate);
    var initialSampleVolumeUl = toNumberOrNull(state.initialSampleVolumeUl);
    var initialCollectionMediaUl = toNumberOrNull(state.initialCollectionMediaUl);
    var sampleConcentrationCellsPerMl = toNumberOrNull(state.sampleConcentrationCellsPerMl);
    var expectedEventRate = toNumberOrNull(state.expectedEventRate);
    var targetFrequencyPercent = toNumberOrNull(state.targetFrequencyPercent);
    var desiredSortedCells = toNumberOrNull(state.desiredSortedCells);

    if (targetFrequencyPercent !== null && (targetFrequencyPercent < 0 || targetFrequencyPercent > 100)) {
      errors.push("Target population frequency must be between 0 and 100%.");
    }

    if (flowRate !== null && (flowRate < 1 || flowRate > 5)) {
      errors.push("Flow rate must be between 1 and 5.");
    }

    if (initialCollectionMediaUl !== null && vesselMaxVolume !== undefined && initialCollectionMediaUl > vesselMaxVolume) {
      errors.push("Initial collection media exceeds the maximum volume of the selected collection vessel.");
    }

    var dropletVolumeNl = nozzleInfo ? nozzleInfo.dropletVolumeNl : null;
    var nozzleFrequency = nozzleInfo ? nozzleInfo.frequencyKhz : null;
    var flowRateUlPerSec = null;
    var eventRateFromConcentration = null;
    var targetEventRate = null;
    var inverseFrequency = null;
    var nonTargetFraction = null;
    var sortEfficiencyPercent = null;
    var sortRate = null;
    var volumePerSortedCellNl = null;
    var timeToSampleDepletionSeconds = null;
    var timeToTargetCellsSeconds = null;
    var maxSortedCellsPerTube = null;

    if (isFiniteNumber(flowRate)) {
      flowRateUlPerSec = APP.FLOW_RATE_EQUATION.m * flowRate + APP.FLOW_RATE_EQUATION.b;
      if (flowRate > 2) {
        statusMessages.push("For sensitive cells, flow rate should not exceed 2.");
      }
    }

    if (isFiniteNumber(sampleConcentrationCellsPerMl) && isFiniteNumber(flowRateUlPerSec)) {
      eventRateFromConcentration = sampleConcentrationCellsPerMl / 1000 * flowRateUlPerSec;
    }

    if (isFiniteNumber(expectedEventRate) && isFiniteNumber(targetFrequencyPercent)) {
      targetEventRate = expectedEventRate * targetFrequencyPercent / 100;
      nonTargetFraction = 1 - targetFrequencyPercent / 100;
    }

    if (isFiniteNumber(nozzleFrequency)) {
      inverseFrequency = 1 / (nozzleFrequency * 1000);
    }

    if (precisionInfo && isFiniteNumber(dropletVolumeNl)) {
      volumePerSortedCellNl = precisionInfo.volumeMaskDrops * dropletVolumeNl;
    }

    if (precisionInfo && precisionInfo.sortEfficiencyMaskDrops === null) {
      warningMessages.push("MODE: Values cannot be accurately determined using the Single Cell precision mode.");
    } else if (
      precisionInfo &&
      isFiniteNumber(expectedEventRate) &&
      isFiniteNumber(inverseFrequency) &&
      isFiniteNumber(nonTargetFraction)
    ) {
      sortEfficiencyPercent = Math.exp(-1 * expectedEventRate * precisionInfo.sortEfficiencyMaskDrops * inverseFrequency * nonTargetFraction) * 100;
    }

    if (isFiniteNumber(targetEventRate) && isFiniteNumber(sortEfficiencyPercent)) {
      sortRate = targetEventRate * sortEfficiencyPercent / 100;
    }

    if (isFiniteNumber(initialSampleVolumeUl) && isFiniteNumber(flowRateUlPerSec) && flowRateUlPerSec > 0) {
      timeToSampleDepletionSeconds = initialSampleVolumeUl / flowRateUlPerSec;
    }

    if (isFiniteNumber(desiredSortedCells) && isFiniteNumber(sortRate) && sortRate > 0) {
      timeToTargetCellsSeconds = desiredSortedCells / sortRate;
    }

    if (
      isFiniteNumber(vesselMaxVolume) &&
      isFiniteNumber(initialCollectionMediaUl) &&
      isFiniteNumber(volumePerSortedCellNl) &&
      volumePerSortedCellNl > 0 &&
      initialCollectionMediaUl <= vesselMaxVolume
    ) {
      maxSortedCellsPerTube = (vesselMaxVolume - initialCollectionMediaUl) / (volumePerSortedCellNl / 1000);
    }

    if (isFiniteNumber(nozzleFrequency) && isFiniteNumber(expectedEventRate) && expectedEventRate > nozzleFrequency * 200) {
      warningMessages.push("WARNING: The Event Rate (evt/s) is higher than the recommended rate for this nozzle.");
    }

    if (isFiniteNumber(timeToTargetCellsSeconds) && timeToTargetCellsSeconds > 7 * 3600) {
      warningMessages.push("WARNING: Your minimum sort time exceeds the maximum available time on a single instrument.");
    }

    if (isFiniteNumber(maxSortedCellsPerTube) && maxSortedCellsPerTube > 0 && isFiniteNumber(desiredSortedCells) && desiredSortedCells > maxSortedCellsPerTube) {
      warningMessages.push(
        "WARNING: Target cells per sample exceeds maximum tube capacity (max approximately " +
        formatNumber(maxSortedCellsPerTube, 0) +
        " cells for the selected vessel/media volume)."
      );
    }

    return {
      values: {
        timeToSampleDepletionSeconds: timeToSampleDepletionSeconds,
        timeToTargetCellsSeconds: timeToTargetCellsSeconds,
        maxSortedCellsPerTube: maxSortedCellsPerTube,
        eventRateFromConcentration: eventRateFromConcentration,
        sortRate: sortRate,
        sortEfficiencyPercent: sortEfficiencyPercent,
        targetEventRate: targetEventRate,
        dropletVolumeNl: dropletVolumeNl,
        flowRateUlPerSec: flowRateUlPerSec,
        volumePerSortedCellNl: volumePerSortedCellNl
      },
      meta: {
        nozzleFrequencyKhz: nozzleFrequency,
        vesselMaxVolumeUl: vesselMaxVolume,
        nonTargetFraction: nonTargetFraction,
        inverseFrequency: inverseFrequency
      },
      statusMessages: statusMessages,
      warningMessages: warningMessages,
      errors: errors
    };
  };

  APP.getRequiredKeysForMode = function (modeId) {
    var mode = findMode(modeId);
    return mode ? mode.requiredKeys.slice() : [];
  };

  function initBrowserApp() {
    if (!global.document) {
      return;
    }

    var state = APP.createInitialState();
    var form = document.getElementById("calculatorForm");
    var modeSwitcher = document.getElementById("modeSwitcher");
    var resultCards = document.getElementById("resultCards");
    var statusBanner = document.getElementById("statusBanner");
    var legendCards = document.getElementById("legendCards");

    populateSelect("precisionMode", getKeys(APP.PRECISION_MODE_INFO));
    populateSelect("nozzle", getKeys(APP.NOZZLES));
    populateSelect("collectionVessel", getKeys(APP.COLLECTION_VESSELS));

    renderModeButtons(modeSwitcher, state);
    renderLegend(legendCards, state);
    renderResults(resultCards, statusBanner, state);
    syncInputs(form, state);
    updateFieldHighlights(form, state.mode);

    modeSwitcher.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-mode]");
      if (!button) {
        return;
      }
      state.mode = button.getAttribute("data-mode");
      renderModeButtons(modeSwitcher, state);
      renderLegend(legendCards, state);
      updateFieldHighlights(form, state.mode);
      renderResults(resultCards, statusBanner, state);
    });

    form.addEventListener("input", function (event) {
      handleInputChange(event.target, state);
      renderLegend(legendCards, state);
      renderResults(resultCards, statusBanner, state);
    });

    form.addEventListener("change", function (event) {
      handleInputChange(event.target, state);
      renderLegend(legendCards, state);
      renderResults(resultCards, statusBanner, state);
    });
  }

  function populateSelect(id, values) {
    var select = document.getElementById(id);
    select.innerHTML = "";
    for (var i = 0; i < values.length; i += 1) {
      var option = document.createElement("option");
      option.value = values[i];
      option.textContent = values[i];
      select.appendChild(option);
    }
  }

  function renderModeButtons(container, state) {
    var html = [];
    for (var i = 0; i < APP.MODES.length; i += 1) {
      var mode = APP.MODES[i];
      var activeClass = mode.id === state.mode ? " active" : "";
      html.push(
        '<button type="button" class="mode-button' + activeClass + '" data-mode="' + escapeHtml(mode.id) + '">' +
          "<strong>" + escapeHtml(mode.title) + "</strong>" +
          "<span>" + escapeHtml(mode.description) + "</span>" +
        "</button>"
      );
    }
    container.innerHTML = html.join("");
  }

  function renderLegend(container, state) {
    var html = [];
    var keys = getKeys(APP.PRECISION_MODE_INFO);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var info = APP.PRECISION_MODE_INFO[key];
      var className = key === state.precisionMode ? "legend-card active" : "legend-card";
      html.push(
        '<article class="' + className + '">' +
          '<span class="legend-title">' + escapeHtml(key) + "</span>" +
          '<p class="legend-copy">' + escapeHtml(info.description) + "</p>" +
        "</article>"
      );
    }
    container.innerHTML = html.join("");
  }

  function renderResults(container, banner, state) {
    var mode = findMode(state.mode);
    var calculation = APP.calculateResults(state);
    var primaryHtml = [];
    var additionalHtml = [];
    var i;

    for (i = 0; i < APP.RESULT_DEFS.length; i += 1) {
      var def = APP.RESULT_DEFS[i];
      var value = calculation.values[def.key];
      var available = isFiniteNumber(value);
      var cardClass = "result-card";
      if (mode && mode.primaryResult === def.key) {
        cardClass += " primary";
      }
      if (!available) {
        cardClass += " unavailable";
      }

      var cardHtml =
        '<article class="' + cardClass + '" data-result-key="' + escapeHtml(def.key) + '">' +
          '<span class="result-label">' + escapeHtml(def.label) + "</span>" +
          '<span class="result-value">' + escapeHtml(formatDisplayValue(def, value)) + "</span>" +
          '<p class="result-meta">' + escapeHtml(def.description + " " + def.unit) + "</p>" +
          renderResultNote(def.key, calculation) +
        "</article>";

      if (i < 4) {
        primaryHtml.push(cardHtml);
      } else {
        additionalHtml.push(cardHtml);
      }
    }

    container.innerHTML =
      primaryHtml.join("") +
      '<div class="result-divider"><h3>Additional Information</h3></div>' +
      additionalHtml.join("");

    if (calculation.errors.length > 0) {
      banner.hidden = false;
      banner.className = "status-banner error";
      banner.textContent = calculation.errors.join(" ");
      return;
    }

    if (calculation.warningMessages.length > 0 || calculation.statusMessages.length > 0) {
      banner.hidden = false;
      banner.className = "status-banner";
      banner.textContent = calculation.warningMessages.concat(calculation.statusMessages).join(" ");
      return;
    }

    banner.hidden = true;
    banner.textContent = "";
  }

  function renderResultNote(key, calculation) {
    if (key === "sortEfficiencyPercent" || key === "sortRate" || key === "timeToTargetCellsSeconds") {
      if (calculation.warningMessages.join(" ").indexOf("Single Cell precision mode") !== -1) {
        return '<p class="result-note">Unavailable in Single Cell mode to match worksheet behavior.</p>';
      }
    }
    return "";
  }

  function formatDisplayValue(definition, value) {
    if (!isFiniteNumber(value)) {
      return "Not available";
    }
    return definition.formatter(value) + " " + definition.unit;
  }

  function syncInputs(form, state) {
    var keys = getKeys(state);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (key === "mode") {
        continue;
      }
      var field = form.querySelector("[name='" + key + "']");
      if (field) {
        field.value = state[key];
      }
    }
  }

  function updateFieldHighlights(form, modeId) {
    var requiredKeys = APP.getRequiredKeysForMode(modeId);
    var fields = form.querySelectorAll("[data-key]");
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      var key = field.getAttribute("data-key");
      var required = requiredKeys.indexOf(key) !== -1;
      field.classList.toggle("mode-required", required);
    }
  }

  function handleInputChange(element, state) {
    if (!element || !element.name) {
      return;
    }
    state[element.name] = element.value;
  }

  function findMode(modeId) {
    for (var i = 0; i < APP.MODES.length; i += 1) {
      if (APP.MODES[i].id === modeId) {
        return APP.MODES[i];
      }
    }
    return null;
  }

  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    var numericValue = Number(value);
    return isFiniteNumber(numericValue) ? numericValue : null;
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  function formatNumber(value, decimals) {
    if (!isFiniteNumber(value)) {
      return "Not available";
    }
    var fixed = value.toFixed(decimals);
    return fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ",").replace(/\.00$/, "");
  }

  function formatDuration(seconds) {
    if (!isFiniteNumber(seconds) || seconds < 0) {
      return "Not available";
    }
    var rounded = Math.round(seconds);
    var hours = Math.floor(rounded / 3600);
    var minutes = Math.floor((rounded % 3600) / 60);
    var remainingSeconds = rounded % 60;
    return hours + ":" + pad2(minutes) + ":" + pad2(remainingSeconds);
  }

  function pad2(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clone(value) {
    var result = {};
    var keys = getKeys(value);
    for (var i = 0; i < keys.length; i += 1) {
      result[keys[i]] = value[keys[i]];
    }
    return result;
  }

  function getKeys(object) {
    var result = [];
    var key;
    for (key in object) {
      if (object.hasOwnProperty(key)) {
        result.push(key);
      }
    }
    return result;
  }

  APP._internal = {
    formatDuration: formatDuration,
    formatNumber: formatNumber
  };

  global.SortCalculatorApp = APP;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = APP;
  }

  initBrowserApp();
}(this));
