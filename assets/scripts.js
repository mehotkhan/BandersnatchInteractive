// Data
var segmentMap = SegmentMap;
var bv = bandersnatch.videos['80988062'].interactiveVideoMoments.value;
var choicePoints = bv.choicePointNavigatorMetadata.choicePointsMetadata.choicePoints;
var momentsBySegment = bv.momentsBySegment;
var segmentGroups = bv.segmentGroups;

// Global mutable state
var captions = {};
var currentSegment;
var nextSegment = null;
var currentMoments = [];
var persistentState = bv.stateHistory;
var globalChoices = {};

function msToString(ms) {
	return new Date(ms).toUTCString().split(' ')[4];
}

function getCurrentMs() {
	return Math.round(document.getElementById("video").currentTime * 1000.0);
}

function preconditionToJS(cond) {
	if (cond[0] == 'persistentState') {
		return '!!persistentState["' + cond[1] + '"]';
	} else if (cond[0] == 'not') {
		return '!(' + preconditionToJS(cond[1]) + ')';
	} else if (cond[0] == 'and') {
		let conds = [];
		for (let i = 1; i < cond.length; i++) {
			conds.push('(' + preconditionToJS(cond[i]) + ')');
		}
		return '(' + conds.join(' && ') + ')';
	} else if (cond[0] == 'or') {
		let conds = [];
		for (let i = 1; i < cond.length; i++) {
			conds.push('(' + preconditionToJS(cond[i]) + ')');
		}
		return '(' + conds.join(' || ') + ')';
	} else {
		console.log('unsupported condition!', cond);
		return 'true';
	}
}

function checkPrecondition(segmentId) {
	let precondition = bv.preconditions[segmentId];

	if (precondition) {
		let cond = preconditionToJS(precondition);
		let match = eval(cond);

		console.log(cond, '==', match);

		return match;
	}

	return true;
}

function findSegment(id) {
	if (id.startsWith('nsg-')) {
		id = id.substr(4);
	}
	if (segmentMap.segments[id]) {
		// check precondition
		return id;
	}

	if (segmentGroups[id]) {
		for (let v of segmentGroups[id]) {
			if (v.segmentGroup) {
				return findSegment(v.segmentGroup);
			} else if (v.segment) {
				// check precondition
				return v.segment;
			} else {
				if (checkPrecondition(v))
					return v;
			}
		}
	}
	return id;
}

/// Returns the segment ID at the given timestamp.
/// There will be exactly one segment for any timestamp within the video file.
function getSegmentId(ms) {
	for (const [k, v] of Object.entries(segmentMap.segments)) {
		if (ms >= v.startTimeMs && ms < v.endTimeMs) {
			return k;
		}
	}
	return null;
}

function getSegmentMs(segmentId) {
	return segmentMap.segments[segmentId].startTimeMs;
}

function getMoments(segmentId, ms) {
	let result = {};
	let moments = momentsBySegment[segmentId] || [];
	for (let i = 0; i < moments.length; i++) {
		let m = moments[i];
		if (ms >= m.startMs && ms < m.endMs) {
			result[segmentId + '/' + i] = m;
		}
	}
	return result;
}

function newList(id) {
	var ul = document.getElementById(id);
	while (ul.firstChild) {
		ul.removeChild(ul.firstChild);
	}
	return ul;
}

function addItem(ul, text, url) {
	var li = document.createElement("li");
	var a = document.createElement("a");
	a.textContent = text;
	a.setAttribute('href', url);
	li.appendChild(a);
	ul.appendChild(li);
}

function setNextSegment(segmentId, comment) {
	console.log('setNextSegment', segmentId, comment);
	nextSegment = segmentId;
	var ul = newList("nextSegment");
	var caption = 'nextSegment: ' + segmentId;
	addItem(ul, comment ? caption + ' (' + comment + ')' : caption,
		'javascript:playSegment("' + segmentId + '")');
}

function addZones(segmentId) {
	var ul = newList("interactionZones");
	let caption = 'currentSegment(' + segmentId + ')';
	addItem(ul, caption, 'javascript:playSegment("' + segmentId + '")');

	var v = segmentMap.segments[segmentId];
	if (v && v.ui && v.ui.interactionZones) {
		var index = 0;
		for (var z of v.ui.interactionZones) {
			var startMs = z[0];
			var stopMs = z[1];
			let caption = segmentId + ' interactionZone ' + index;
			addItem(ul, caption, 'javascript:seek(' + startMs + ')');
			index++;
		}
	}

	ul = newList("nextSegments");
	for (const [k, v] of Object.entries(segmentMap.segments[segmentId].next)) {
		let caption = captions[k] ? captions[k] : k;
		if (segmentMap.segments[segmentId].defaultNext == k) {
			caption = '[' + caption + ']';
			setNextSegment(k);
		}
		addItem(ul, caption, 'javascript:playSegment("' + k + '")');
	}
}

function addChoices(r) {
	var ul = newList("choices");
	document.getElementById("choiceCaption").innerHTML = '';
	if (!r) return;
	let index = 0;

	for (let x of r.choices) {
		console.log(x.id, 'choice saved');
		globalChoices[x.id] = x;

		var caption = r.defaultChoiceIndex == index ? '[' + x.text + ']' : x.text;
		addItem(ul, caption, 'javascript:choice("' +
			(x.segmentId ? x.segmentId : (x.sg ? x.sg : x.id)) + '", "' + x.text + '", "' + x.id + '")');
		index++;
	}

	if (r.id in choicePoints)
		document.getElementById("choiceCaption").innerHTML = choicePoints[r.id].description;
}

function momentStart(m, seeked) {
	console.log('momentStart', m, seeked);
	if (m.type == 'scene:cs_bs') {
		addZones(currentSegment);
		addChoices(m);
	}
	if (!seeked)
		applyImpression(m.impressionData);
}

function momentUpdate(m, ms) {
	//console.log('momentUpdate', m);
	if (m.type == 'scene:cs_bs') {
		var p = 100 - Math.floor((ms - m.startMs) * 100 / (m.endMs - m.startMs));
		document.getElementById("progress").style.width = p + '%';
	}
}

function momentEnd(m, seeked) {
	console.log('momentEnd', m, seeked);
	if (m.type == 'scene:cs_bs') {
		setNextSegment(null);
		addZones(currentSegment);
		addChoices(0);
		document.getElementById("progress").style.width = 0;
	}
}

var timerId = 0;
var lastMs = 0;

function ontimeupdate(evt) {
	var ms = getCurrentMs();
	var segmentId = getSegmentId(ms);

	// ontimeupdate resolution is about a second. Augment it using timer.
	if (timerId) {
		clearTimeout(timerId);
		timerId = 0;
	}
	if (segmentId && nextSegment && nextSegment != segmentId) {
		var timeLeft = segmentMap.segments[segmentId].endTimeMs - ms;
		timerId = setTimeout(ontimeupdate, timeLeft);
	}

	// Distinguish between the user seeking manually with <video> controls,
	// and the video playing normally (past some timestamp / boundary).
	let timeElapsed = ms - lastMs;
	let seeked = timeElapsed >= 0 && timeElapsed < 2000;
	lastMs = ms;

	// Recalculate title and hash only when we pass some meaningful timestamp.
	let placeChanged = false;

	if (currentSegment != segmentId) {
		console.log('ontimeupdate', currentSegment, segmentId, ms, msToString(ms));
		if (seeked) {
			playSegment(segmentId, true);
		} else {
			// TODO: activate and apply user choice (whether or not it
			// was default) instead of just playing the next segment.
			playSegment(nextSegment, true);
		}
		currentSegment = segmentId;
		placeChanged = true;
	}

	var moments = getMoments(segmentId, ms);
	for (let k in currentMoments)
		if (!(k in moments)) {
			momentEnd(currentMoments[k], seeked);
			placeChanged = true;
		}
	for (let k in currentMoments)
		if (k in moments)
			momentUpdate(currentMoments[k], ms);
	for (let k in moments)
		if (!(k in currentMoments)) {
			momentStart(moments[k], seeked);
			placeChanged = true;
		}
	currentMoments = moments;

	if (placeChanged) {
		let title = 'Bandersnatch';
		title += ' - Chapter ' + segmentId;
		for (let k in moments) {
			let m = moments[k];
			if (m.type.substr(0, 6) == 'scene:') {
				if (m.id && m.id in choicePoints && choicePoints[m.id].description)
					title += ' - Choice "' + choicePoints[m.id].description + '"';
				else
					title += ' - Choice ' + (m.id || k);
			}
		}
		document.title = title;

		let hash = segmentId;
		// Pick the moment which starts closer to the current timestamp.
		let bestMomentStart = segmentMap.segments[segmentId].startTimeMs;
		for (let k in moments) {
			let m = moments[k];
			if (m.startMs > bestMomentStart) {
				hash = k;
				bestMomentStart = m.startMs;
			}
		}
		hash = '#' + hash;
		lastHash = hash; // suppress onhashchange event
		location.hash = hash;
	}
}

function jumpForward() {
	var ms = getCurrentMs();
	var segmentId = getSegmentId(ms);
	var v = segmentMap.segments[segmentId];

	var interactionMs = 0;
	if (v && v.ui && v.ui.interactionZones) {
		for (var z of v.ui.interactionZones) {
			var startMs = z[0];
			var stopMs = z[1];
			if (ms < startMs)
				interactionMs = startMs;
		}
	}

	if (interactionMs) {
		seek(interactionMs);
	} else {
		playSegment(nextSegment);
	}
}

function jumpBack() {
	var ms = getCurrentMs();
	var segmentId = getSegmentId(ms);
	var startMs = getSegmentMs(segmentId);
	var previousSegment = getSegmentId(startMs - 1000);
	console.log('jumpBack from-to', segmentId, previousSegment);
	playSegment(previousSegment);
}

function toggleFullScreen() {
	console.log('toggleFullScreen');
	var c = document.getElementById("c");
	if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
		if (c.requestFullscreen) {
			c.requestFullscreen();
		} else if (c.msRequestFullscreen) {
			c.msRequestFullscreen();
		} else if (c.mozRequestFullScreen) {
			c.mozRequestFullScreen();
		} else if (c.webkitRequestFullscreen) {
			c.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
		}
	} else {
		if (document.exitFullscreen) {
			document.exitFullscreen();
		} else if (document.msExitFullscreen) {
			document.msExitFullscreen();
		} else if (document.mozCancelFullScreen) {
			document.mozCancelFullScreen();
		} else if (document.webkitExitFullscreen) {
			document.webkitExitFullscreen();
		}
	}
}

function togglePlayPause() {
	var v = document.getElementById("video");
	if (v.paused) v.play();
	else v.pause();
}

window.onload = function() {
	var video_selector = document.getElementById("video");
	var video_source_selector = document.getElementById("video-source");
	var file_selector = document.getElementById("file-selector");
	function startPlayback() {
		file_selector.style.display = 'none';
		if (window.location.hash)
			playHash(window.location.hash);
		else
			playSegment(null);
		video_selector.play();
	}
	if (video_source_selector.getAttribute("src") == '') {
		console.log('no video');
		file_selector.style.display = 'table';
		document.getElementById("wrapper-video").style.display = 'none';
	} else {
		startPlayback();
	}
	document.getElementById('fileinput').addEventListener('change', function () {
		var file = this.files[0];
		var fileUrl = URL.createObjectURL(file);
		video_selector.src = fileUrl;
		document.getElementById("wrapper-video").style.display = 'block';
		startPlayback();
	}, false);

	video_selector.ontimeupdate = ontimeupdate;

	var c = document.getElementById("c");
	c.ondblclick = toggleFullScreen;
	c.onclick = function () {
		// can't togglePlayPause here, choice buttons stop the video
		// should use preventdefault or something
		// use spacebar for now
		// mind that autoplay is disabled in latest chrome, so play after click
		document.getElementById("video").play();
	};

	document.onkeypress = function (e) {
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)
			return;
		if (e.code == 'KeyF')
			toggleFullScreen();
		if (e.code == 'KeyR')
			playSegment(0);
		if (e.code == 'Space')
			togglePlayPause();
	};

	document.onkeydown = function (e) {
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)
			return;
		if (e.key == 'ArrowLeft') {
			jumpBack();
		}
		if (e.key == 'ArrowRight') {
			jumpForward();
		}
	};

	window.onhashchange = function() {
		playHash(window.location.hash);
	};
};

function seek(ms) {
	clearTimeout(timerId);
	console.log('seek', ms);
	momentSelected = null;
	lastMs = ms;
	currentSegment = getSegmentId(ms);
	document.getElementById("video").currentTime = ms / 1000.0;
}

function choice(choiceId, text, id) {
	var segmentId = findSegment(choiceId);
	console.log('choice', choiceId, 'nextSegment', segmentId);
	applyImpression(globalChoices[id].impressionData);
	setNextSegment(segmentId, text);
	momentSelected = choiceId;
	addChoices(0);
}

function applyImpression(impressionData) {
	if (impressionData && impressionData.type == 'userState') {
		for (const [variable, value] of Object.entries(impressionData.data.persistent)) {
			console.log('persistentState set', variable, '=', value);
			persistentState[variable] = value;
		}
	}
}

function playSegment(segmentId, noSeek) {
	if (!segmentId || typeof segmentId === "undefined")
		segmentId = segmentMap.initialSegment;
	var oldSegment = getSegmentId(getCurrentMs());
	console.log('playSegment', oldSegment, '->', segmentId);
	if (!noSeek || oldSegment != segmentId) {
		var ms = getSegmentMs(segmentId);
		seek(ms);
	}
}

var lastHash = '';
function playHash(hash) {
	// console.log('playHash', lastHash, '->', hash);
	if (hash == lastHash)
		return;
	lastHash = hash;
	if (hash) {
		hash = hash.slice(1);
		if (hash[0] == 't')
			seek(Number(Math.round(hash.slice(1) * 1000.0)));
		else {
			let loc = hash.split('/');
			let segmentId = loc[0];
			if (loc.length > 1)
				seek(momentsBySegment[segmentId][loc[1]].startMs);
			else
				seek(getSegmentMs(segmentId));
		}
	}
}
