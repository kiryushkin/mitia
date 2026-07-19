        (function() {
            const userEmail = localStorage.getItem('chat_user_email');
            const loginLink = document.getElementById('login-link');
            if (userEmail && loginLink) {
                loginLink.textContent = userEmail;
                loginLink.href = '/admin';
            }
        })();

        (function() {
            function canvasSupport() {
                return !!document.createElement('canvas').getContext;
            }
            if (!canvasSupport()) return;

            let sphereRad = Math.min(window.innerWidth * 0.45, 550);
            let radius_sp = 1;
            let numToAddEachFrame = 18;
            let wait = 1;
            let count = wait - 1;
            let particleList = {};
            let recycleBin = {};
            const baseOrbColor = { r: 112, g: 255, b: 140 };
            const redOrbColor = { r: 255, g: 77, b: 77 };
            let r = baseOrbColor.r, g = baseOrbColor.g, b = baseOrbColor.b;
            window.isMulticolor = false;
            window.multicolorIntensity = 0;
            window.orbPresentationAlpha = 1;
            window.orbBlinkFactor = 1;
            window.orbRedBlend = 0;
            window.redDotsVisibility = 1;
            window.redDotsSectorFade = 0;
            window.orbSphereScale = 1;
            window.orbSphereScaleTarget = 1;
            window.localGreenRecovery = 0;
            window.isLowDensityActive = false;
            window.lowDensityStrength = 0;
            window.lowDensityMinFactor = 0.38;
            window.lowDensityMaskSeed = 0.37;
            window.isExplosionActive = false;
            window.explosionTriggered = false;
            window.isReassembleActive = false;
            window.reassembleStrength = 0;
            window.explosionBlend = 0;
            window.isFlowStreamActive = false;
            window.flowStreamStrength = 0;
            window.flowStreamAngle = -0.55;
            window.flowStreamDrift = 0;
            window.flowStreamWobble = 0;
            window.isCenterInflowActive = false;
            window.centerInflowStrength = 0;
            window.centerInflowParticles = [];
            window.centerPinnedPoints = [];
            window.centerInflowSpawnAccumulator = 0;
            window.centerInflowHitCount = 0;
            window.centerInflowCoverage = 0;
            window.isMessengerSectorActive = false;
            window.messengerSectorStrength = 0;
            window.messengerSectorPhase = 0;
            const multicolorPalette = [
                {r: 112, g: 255, b: 140}, 
                {r: 255, g: 77, b: 77},  
                {r: 77, g: 255, b: 255}, 
                {r: 255, g: 255, b: 77}, 
                {r: 255, g: 77, b: 255}, 
                {r: 140, g: 112, b: 255} 
            ];
            let rgbString = "rgba(" + r + "," + g + "," + b + ",";

            function setOrbColor(nextR, nextG, nextB) {
                r = Math.round(nextR);
                g = Math.round(nextG);
                b = Math.round(nextB);
                rgbString = "rgba(" + r + "," + g + "," + b + ",";
            }

            function applyMessengerSectorBrightness(baseColor, baseAlpha, angleRad) {
                if (!window.isMessengerSectorActive || (window.messengerSectorStrength || 0) <= 0) {
                    return { color: baseColor, alpha: baseAlpha };
                }

                const sectors = 8;
                const phase = (window.messengerSectorPhase || 0) % sectors;
                const sectorPos = (angleRad / (2 * Math.PI)) * sectors;
                let dist = Math.abs(sectorPos - phase);
                dist = Math.min(dist, sectors - dist);

                const localBoost = Math.max(0, 1 - dist);
                const k = localBoost * (window.messengerSectorStrength || 0);
                if (k <= 0) return { color: baseColor, alpha: baseAlpha };

                const color = {
                    r: Math.round(baseColor.r + (255 - baseColor.r) * (0.9 * k)),
                    g: Math.round(baseColor.g + (255 - baseColor.g) * (0.9 * k)),
                    b: Math.round(baseColor.b + (255 - baseColor.b) * (0.9 * k))
                };
                const alpha = Math.min(1, baseAlpha * (1 + 1.1 * k));
                return { color, alpha };
            }

            window.baseOrbColor = baseOrbColor;
            window.redOrbColor = redOrbColor;
            window.setOrbColor = setOrbColor;
            window.setOrbColor(baseOrbColor.r, baseOrbColor.g, baseOrbColor.b);

            let particleAlpha = 1;
            let displayWidth, displayHeight;
            let fLen = 320;
            let projCenterX, projCenterY;
            let zMax = fLen - 2;
            let particleRad = 2.5;
            let sphereCenterX = 0;
            let sphereCenterY = 0;
            let sphereCenterZ = -3 - sphereRad;
            let zeroAlphaDepth = -750;
            let gravity = 0;
            let randAccelX = 0.1, randAccelY = 0.1, randAccelZ = 0.1;
            let currentAngleY = 0, currentAngleX = 0;
            let targetAngleY = 0, targetAngleX = 0;
            const FOLLOW_SPEED = 0.08;
            let mouseIdle = true;
            let lastMouseMoveTime = Date.now();
            const IDLE_DELAY_MS = 600;
            let autoSpeedY = 0.005, autoSpeedX = 0.003;
            let nextSpeedChangeFrames = 0;
            let theCanvas = document.getElementById("canvasOne");
            let context = theCanvas.getContext("2d");
            let timer;
            let audioAnalyser = null;
            let dataArray = null;
            let audioCtx = null;
            let volumeRaf = null;

            window.currentAudioVolume = 0;

            window.stopAudioAnalysis = function() {
                if (volumeRaf) {
                    cancelAnimationFrame(volumeRaf);
                    volumeRaf = null;
                }
                if (audioCtx) {
                    try { audioCtx.close(); } catch (_) {}
                    audioCtx = null;
                }
                audioAnalyser = null;
                dataArray = null;
                window.currentAudioElement = null;
                window.currentAudioVolume = 0;
            };

            window.resumePresentationAudioContext = function() {
                if (!audioCtx) return;
                if (audioCtx.state === 'suspended') {
                    audioCtx.resume().catch(() => {});
                }
            };

            window.setupAudioAnalysis = function(audioElement) {
                if (audioAnalyser && audioElement === window.currentAudioElement) {
                    window.resumePresentationAudioContext();
                    return;
                }

                const startAnalysis = (audio) => {
                    try {
                        window.stopAudioAnalysis();

                        const AudioContext = window.AudioContext || window.webkitAudioContext;
                        audioCtx = new AudioContext();

                        const source = audioCtx.createMediaElementSource(audio);
                        audioAnalyser = audioCtx.createAnalyser();
                        audioAnalyser.fftSize = 128;
                        audioAnalyser.smoothingTimeConstant = 0.82;
                        source.connect(audioAnalyser);
                        audioAnalyser.connect(audioCtx.destination);
                        dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
                        window.currentAudioElement = audio;

                        if (audioCtx.state === 'suspended') {
                            audioCtx.resume();
                        }

                        const tickVolume = () => {
                            if (!audioAnalyser || !dataArray) return;
                            audioAnalyser.getByteFrequencyData(dataArray);
                            let max = 0;
                            for (let i = 0; i < dataArray.length; i++) {
                                if (dataArray[i] > max) max = dataArray[i];
                            }
                            window.currentAudioVolume = max / 255;
                            volumeRaf = requestAnimationFrame(tickVolume);
                        };

                        tickVolume();
                        console.log("Audio analysis started on:", audio);
                    } catch (e) {
                        console.warn("Audio analysis already attached or failed:", e);
                    }
                };

                if (audioElement) {
                    startAnalysis(audioElement);
                } else {
                    const findAudio = () => {
                        const widgetAudio = document.querySelector('audio');
                        if (widgetAudio) startAnalysis(widgetAudio);
                        else setTimeout(findAudio, 500);
                    };
                    findAudio();
                }
            }

            window.addEventListener('mitya-audio-start', (e) => {
                if (e.detail && e.detail.audio) {
                    window.setupAudioAnalysis(e.detail.audio);
                    window.presentationModeActive = true;
                    document.body.classList.add('presentation-mode');
                }
            });

            window.addEventListener('mitya-audio-end', () => {
                window.presentationModeActive = false;
                document.body.classList.remove('presentation-mode');
            });

            function addParticle(x0, y0, z0, vx0, vy0, vz0) {
                let newParticle;
                if (recycleBin.first != null) {
                    newParticle = recycleBin.first;
                    if (newParticle.next != null) {
                        recycleBin.first = newParticle.next;
                        newParticle.next.prev = null;
                    } else {
                        recycleBin.first = null;
                    }
                } else {
                    newParticle = {};
                }
                if (particleList.first == null) {
                    particleList.first = newParticle;
                    newParticle.prev = null;
                    newParticle.next = null;
                } else {
                    newParticle.next = particleList.first;
                    particleList.first.prev = newParticle;
                    particleList.first = newParticle;
                    newParticle.prev = null;
                }
                newParticle.x = x0; newParticle.y = y0; newParticle.z = z0;
                newParticle.velX = vx0; newParticle.velY = vy0; newParticle.velZ = vz0;
                newParticle.age = 0; newParticle.dead = false;
                newParticle.attack = 50; newParticle.hold = 50; newParticle.decay = 100;
                newParticle.initValue = 0; newParticle.holdValue = particleAlpha; newParticle.lastValue = 0;
                newParticle.stuckTime = 90 + Math.random() * 20;
                newParticle.accelX = 0; newParticle.accelY = gravity; newParticle.accelZ = 0;
                newParticle.alpha = 0;
                return newParticle;
            }

            function recycle(p) {
                if (particleList.first == p) {
                    if (p.next != null) { p.next.prev = null; particleList.first = p.next; }
                    else { particleList.first = null; }
                } else {
                    if (p.next == null) { p.prev.next = null; }
                    else { p.prev.next = p.next; p.next.prev = p.prev; }
                }
                if (recycleBin.first == null) { recycleBin.first = p; p.prev = null; p.next = null; }
                else { p.next = recycleBin.first; recycleBin.first.prev = p; recycleBin.first = p; p.prev = null; }
            }

            function generateParticles() {
                for (let i = 0; i < numToAddEachFrame; i++) {
                    let theta = Math.random() * 2 * Math.PI;
                    let phi = Math.acos(Math.random() * 2 - 1);
                    let x0 = sphereRad * Math.sin(phi) * Math.cos(theta);
                    let y0 = sphereRad * Math.sin(phi) * Math.sin(theta);
                    let z0 = sphereRad * Math.cos(phi);
                    let vMult = 0.002;
                    addParticle(x0, sphereCenterY + y0, sphereCenterZ + z0, vMult * x0, vMult * y0, vMult * z0);
                }
            }

            function rotatePoint(px, py, pz, angleY, angleX) {
                const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
                let x1 = cosY * px + sinY * pz, z1 = -sinY * px + cosY * pz, y1 = py;
                const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
                let y2 = cosX * y1 - sinX * z1, z2 = sinX * y1 + cosX * z1, x2 = x1;
                return { x: x2, y: y2, z: z2 };
            }

            function randomizeAutoMovement() {
                autoSpeedY = (Math.random() * 0.023 + 0.002) * (Math.random() > 0.5 ? 1 : -1);
                autoSpeedX = (Math.random() * 0.018 + 0.002) * (Math.random() > 0.5 ? 1 : -1);
                nextSpeedChangeFrames = Math.floor(Math.random() * 210 + 90);
            }

            function updateAutoMovement() {
                targetAngleY += autoSpeedY;
                targetAngleX += autoSpeedX;
                if (targetAngleX > Math.PI / 2.2) targetAngleX = Math.PI / 2.2;
                if (targetAngleX < -Math.PI / 2.2) targetAngleX = -Math.PI / 2.2;
                nextSpeedChangeFrames--;
                if (nextSpeedChangeFrames <= 0) randomizeAutoMovement();
            }

            function initSphere() {
                const rect = theCanvas.getBoundingClientRect();
                theCanvas.width = rect.width;
                theCanvas.height = rect.height;
                
                displayWidth = theCanvas.width;
                displayHeight = theCanvas.height;
                projCenterX = displayWidth / 2;
                projCenterY = displayHeight / 2;
                particleList = {}; recycleBin = {};
                randomizeAutoMovement();
                for (let i = 0; i < 200; i++) {
                    let theta = Math.random() * 2 * Math.PI;
                    let phi = Math.acos(Math.random() * 2 - 1);
                    let x0 = sphereRad * Math.sin(phi) * Math.cos(theta);
                    let y0 = sphereRad * Math.sin(phi) * Math.sin(theta);
                    let z0 = sphereRad * Math.cos(phi);
                    addParticle(x0, sphereCenterY + y0, sphereCenterZ + z0, 0.001 * x0, 0.001 * y0, 0.001 * z0);
                }
                timer = setInterval(onTimer, 1000 / 60);
            }

            function onTimer() {
                const now = Date.now();
                const mouseIsActive = performance.now() < window.heroOrbMouseActiveUntil;

                const currentScale = window.orbSphereScale ?? 1;
                const targetScale = window.orbSphereScaleTarget ?? 1;
                window.orbSphereScale = currentScale + (targetScale - currentScale) * 0.08;
                
                let audioVal = window.currentAudioVolume || 0;
                
                if (!mouseIdle && (now - lastMouseMoveTime > IDLE_DELAY_MS)) {
                    mouseIdle = true;
                    randomizeAutoMovement();
                }
                if (window.presentationModeActive) {
                    targetAngleY += 0.005;
                    targetAngleX = Math.sin(now * 0.001) * 0.2;

                    const BASE_RADIUS = Math.min(window.innerWidth * 0.45, 550);
                    const VOICE_EXPANSION = BASE_RADIUS * 0.1;
                    const CONTAINER_SCALE = 0.2;
                    const SHAKE_INTENSITY = 10;

                    sphereRad = (BASE_RADIUS + (audioVal * VOICE_EXPANSION)) * (window.orbSphereScale ?? 1);
                    
                    const container = document.querySelector('.cl-hero-orb-container');
                    if (container) {
                        const scale = 1.0 + (audioVal * CONTAINER_SCALE);
                        let shakeX = (Math.random() - 0.5) * (audioVal * SHAKE_INTENSITY);
                        let shakeY = (Math.random() - 0.5) * (audioVal * SHAKE_INTENSITY);
                        
                        container.style.transform = `translate(calc(-50% + ${shakeX}px), calc(-50% + ${shakeY}px)) scale(${scale})`;
                        container.style.opacity = 0.8 + (audioVal * 0.2);
                    }
                } else {
                    if (mouseIdle) updateAutoMovement();
                    sphereRad = Math.min(window.innerWidth * 0.45, 550);
                    window.orbSphereScaleTarget = 1;
                    window.orbSphereScale = (window.orbSphereScale ?? 1) + (1 - (window.orbSphereScale ?? 1)) * 0.08;
                }

                currentAngleY += (targetAngleY - currentAngleY) * FOLLOW_SPEED;
                currentAngleX += (targetAngleX - currentAngleX) * FOLLOW_SPEED;
                count++;
                const shouldGenerateSphereParticles = !window.isExplosionActive && !window.isReassembleActive;
                if (shouldGenerateSphereParticles && count >= wait) {
                    count = 0;
                    generateParticles();
                }
                context.clearRect(0, 0, displayWidth, displayHeight);

                if (window.isExplosionActive && !window.explosionTriggered) {
                    let ep = particleList.first;
                    while (ep != null) {
                        const dx = ep.x - sphereCenterX;
                        const dy = ep.y - sphereCenterY;
                        const dz = ep.z - sphereCenterZ;
                        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                        const burstForce = 9.0 + Math.random() * 5.0;
                        ep.velX += (dx / dist) * burstForce + (Math.random() - 0.5) * 6.5;
                        ep.velY += (dy / dist) * burstForce + (Math.random() - 0.5) * 6.5;
                        ep.velZ += (dz / dist) * burstForce + (Math.random() - 0.5) * 6.5;
                        ep.burstVX = ep.velX;
                        ep.burstVY = ep.velY;
                        ep.burstVZ = ep.velZ;
                        ep.age = ep.stuckTime + 1;
                        ep.burstApplied = true;
                        ep = ep.next;
                    }
                    window.orbSoundWaves = [];
                    window.orbBurstParticles = [];
                    window.explosionTriggered = true;
                }

                let p = particleList.first;
                while (p != null) {
                    let nextParticle = p.next;
                    p.age++;
                    
                    if (mouseIsActive && p.age > p.stuckTime) {
                        const mult = 1.05;
                        p.velX *= mult; p.velY *= mult; p.velZ *= mult;
                        p.age += 2;
                    } else if (window.presentationModeActive && audioVal > 0.05 && p.age > p.stuckTime) {
                        const mult = 1.05 + (audioVal * 0.15);
                        p.velX *= mult; p.velY *= mult; p.velZ *= mult;
                        p.age += 1 + Math.floor(audioVal * 5);
                    } else if (window.presentationModeActive && audioVal <= 0.05 && p.age > p.stuckTime) {
                        p.velX *= 0.9; p.velY *= 0.9; p.velZ *= 0.9;
                    }

                    if (p.age > p.stuckTime) {
                        p.velX += p.accelX + randAccelX * (Math.random() * 2 - 1);
                        p.velY += p.accelY + randAccelY * (Math.random() * 2 - 1);
                        p.velZ += p.accelZ + randAccelZ * (Math.random() * 2 - 1);

                        if (window.isExplosionActive) {
                        }

                        if (window.isReassembleActive) {
                            if (p.burstVX !== undefined) {
                                const reverseSpeed = (window.reassembleStrength || 0) * 0.45;
                                p.velX = -p.burstVX * reverseSpeed;
                                p.velY = -p.burstVY * reverseSpeed;
                                p.velZ = -p.burstVZ * reverseSpeed;
                            }

                            const dx = p.x - sphereCenterX;
                            const dy = p.y - sphereCenterY;
                            const dz = p.z - sphereCenterZ;
                            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                            const nx = dx / dist;
                            const ny = dy / dist;
                            const nz = dz / dist;

                            const targetX = sphereCenterX + nx * sphereRad;
                            const targetY = sphereCenterY + ny * sphereRad;
                            const targetZ = sphereCenterZ + nz * sphereRad;

                            const pull = 0.008 + (window.reassembleStrength || 0) * 0.06;
                            p.velX += (targetX - p.x) * pull;
                            p.velY += (targetY - p.y) * pull;
                            p.velZ += (targetZ - p.z) * pull;

                            p.velX *= 0.92;
                            p.velY *= 0.92;
                            p.velZ *= 0.92;

                            p.age = 0;
                            p.dead = false;
                            p.alpha = 1;
                            p.burstApplied = false;
                        }

                        if (window.isExplosionActive && p.burstVX === undefined) {
                            p.burstVX = p.velX;
                            p.burstVY = p.velY;
                            p.burstVZ = p.velZ;
                        }

                        if (window.isReassembleActive && window.reassembleStrength >= 0.999) {
                            p.burstVX = undefined;
                            p.burstVY = undefined;
                            p.burstVZ = undefined;
                        }


                        if (!window.isExplosionActive && !window.isReassembleActive) {
                            p.burstApplied = false;
                        }

                        p.x += p.velX;
                        p.y += p.velY;
                        p.z += p.velZ;
                    }
                    let localX = p.x - sphereCenterX, localY = p.y - sphereCenterY, localZ = p.z - sphereCenterZ;
                    let rotatedLocal = rotatePoint(localX, localY, localZ, targetAngleY, targetAngleX);
                    let finalX = rotatedLocal.x + sphereCenterX, finalY = rotatedLocal.y + sphereCenterY, finalZ = rotatedLocal.z + sphereCenterZ;
                    let projScale = radius_sp * fLen / (fLen - finalZ);
                    let projX = finalX * projScale + projCenterX, projY = finalY * projScale + projCenterY;
                    if (window.isExplosionActive || window.isReassembleActive) {
                        p.dead = false;
                        p.alpha = Math.max(p.alpha, 0.65);
                    } else if (p.age < p.attack + p.hold + p.decay) {
                        if (p.age < p.attack) p.alpha = (p.holdValue - p.initValue) / p.attack * p.age + p.initValue;
                        else if (p.age < p.attack + p.hold) p.alpha = p.holdValue;
                        else p.alpha = (p.lastValue - p.holdValue) / p.decay * (p.age - p.attack - p.hold) + p.holdValue;
                    } else { p.dead = true; }

                    const outOfBounds = projX > displayWidth || projX < 0 || projY < 0 || projY > displayHeight || finalZ > zMax;
                    if ((outOfBounds || p.dead) && !(window.isExplosionActive || window.isReassembleActive)) {
                        recycle(p);
                    } else {
                        let depthAlpha = (1 - finalZ / zeroAlphaDepth);
                        depthAlpha = (depthAlpha > 1) ? 1 : ((depthAlpha < 0) ? 0 : depthAlpha);
                        const finalAlpha = depthAlpha * p.alpha;
                        
                        const particleThreshold = Math.abs((p.x + p.y + p.z) % 1);
                        const angle = Math.atan2(p.y, p.x) + Math.PI;
                        const colorIndex = Math.floor((angle / (2 * Math.PI)) * multicolorPalette.length) % multicolorPalette.length;

                        let densityFade = 1;
                        if (window.isLowDensityActive && !window.isExplosionActive && !window.isReassembleActive) {
                            const maskNoise = Math.abs(Math.sin((p.x * 0.016) + (p.y * 0.021) + (p.z * 0.013) + window.lowDensityMaskSeed));
                            const keepFactor = 1 - (window.lowDensityStrength || 0) * (1 - (window.lowDensityMinFactor || 0.38));
                            densityFade = maskNoise < keepFactor ? 1 : 0;
                        }

                        const presentationVisibility = (window.orbPresentationAlpha ?? 1) * (window.orbBlinkFactor ?? 1);
                        const dotVisibility = window.redDotsVisibility ?? 1;
                        const sectorFade = window.redDotsSectorFade ?? 0;
                        const sectorCount = 8;
                        const sectorPos = (angle / (2 * Math.PI)) * sectorCount;
                        const currentSector = Math.floor(sectorPos) % sectorCount;
                        const sweepProgress = Math.min(1, Math.max(0, sectorFade));
                        const sweepSectors = sweepProgress * sectorCount;
                        const sectorFraction = sectorPos - Math.floor(sectorPos);
                        const isSectorBeingHidden = currentSector < Math.floor(sweepSectors) || (currentSector == Math.floor(sweepSectors) && sectorFraction < (sweepSectors % 1));
                        const sectorMask = Math.abs(Math.sin((p.x * 0.012) + (p.y * 0.015) + (p.z * 0.018) + 0.77));
                        const partialThreshold = 0.42 + 0.42 * sweepProgress;
                        const hiddenBySector = isSectorBeingHidden && sectorMask < partialThreshold;
                        const effectiveDotVisibility = hiddenBySector ? 0 : dotVisibility;
                        const pointAlpha = finalAlpha * densityFade * presentationVisibility * effectiveDotVisibility;
                        const shouldDrawPoint = pointAlpha >= 0.01;

                        const localRecovery = window.localGreenRecovery ?? 0;
                        const localMask = Math.abs(Math.sin((p.x * 0.017) + (p.y * 0.019) + (p.z * 0.023) + 0.37));
                        const useRecoveredGreen = localRecovery > 0 && localMask < localRecovery;

                        const pinnedPoints = window.centerPinnedPoints || [];
                        const coverage = window.centerInflowCoverage || 0;
                        let pinnedColor = null;
                        if (pinnedPoints.length > 0 && coverage > 0) {
                            const pinNoise = Math.abs(Math.sin((p.x * 0.014) + (p.y * 0.017) + (p.z * 0.019) + 0.23));
                            if (pinNoise < coverage) {
                                const pinIndex = Math.min(pinnedPoints.length - 1, Math.floor(pinNoise * pinnedPoints.length));
                                pinnedColor = pinnedPoints[pinIndex] || null;
                            }
                        }

                        if (pinnedColor) {
                            const tuned = applyMessengerSectorBrightness(pinnedColor, pointAlpha, angle);
                            context.fillStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                        } else if (useRecoveredGreen) {
                            const tuned = applyMessengerSectorBrightness(baseOrbColor, pointAlpha, angle);
                            context.fillStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                        } else if (window.isMulticolor && (particleThreshold < window.multicolorIntensity)) {
                            const color = multicolorPalette[colorIndex];
                            const tuned = applyMessengerSectorBrightness(color, pointAlpha, angle);
                            context.fillStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                        } else {
                            const tuned = applyMessengerSectorBrightness({ r, g, b }, pointAlpha, angle);
                            context.fillStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                        }
                        
                        if (shouldDrawPoint) {
                            context.beginPath();
                            context.arc(projX, projY, projScale * particleRad, 0, 2 * Math.PI);
                            context.fill();
                        }

                        const audioVal = window.currentAudioVolume || 0;
                        if (p === particleList.first) {
                            const coreSize = 3 + (audioVal * 4);
                            const coreAlpha = (0.8 + audioVal * 0.2) * presentationVisibility;
                            context.fillStyle = rgbString + coreAlpha + ")";
                            context.beginPath();
                            context.arc(projCenterX, projCenterY, coreSize, 0, Math.PI * 2);
                            context.fill();
                            
                            context.shadowBlur = 10 * audioVal;
                            context.shadowColor = rgbString + "1)";

                            if (!window.orbBurstParticles) window.orbBurstParticles = [];
                            if (!window.orbSoundWaves) window.orbSoundWaves = [];
                            
                            if (audioVal > 0.1) {
                                if (Math.random() < audioVal * 0.5) {
                                    const angle = Math.random() * Math.PI * 2;
                                    window.orbBurstParticles.push({ 
                                        x: projCenterX, 
                                        y: projCenterY, 
                                        vx: Math.cos(angle) * (2 + audioVal * 8), 
                                        vy: Math.sin(angle) * (2 + audioVal * 8), 
                                        life: 1.0,
                                        size: 1 + Math.random() * 2
                                    });
                                }
                                if (Math.random() < audioVal * 0.15) {
                                    window.orbSoundWaves.push({
                                        r: coreSize,
                                        alpha: audioVal * 0.4,
                                        maxR: sphereRad * (0.3 + audioVal * 0.4)
                                    });
                                }
                            }

                            if (window.isExplosionActive) {
                                window.orbSoundWaves = [];
                                window.orbBurstParticles = [];
                            }

                            for (let i = window.orbSoundWaves.length - 1; i >= 0; i--) {
                                const w = window.orbSoundWaves[i];
                                w.r += 3 + audioVal * 4;
                                w.alpha *= 0.94;
                                if (w.alpha < 0.01 || w.r > w.maxR) {
                                    window.orbSoundWaves.splice(i, 1);
                                    continue;
                                }
                                context.beginPath();
                                context.arc(projCenterX, projCenterY, w.r, 0, Math.PI * 2);
                                context.strokeStyle = rgbString + (w.alpha * presentationVisibility) + ")";
                                context.lineWidth = 1.5;
                                context.stroke();
                            }

                            for (let i = window.orbBurstParticles.length - 1; i >= 0; i--) {
                                const bp = window.orbBurstParticles[i];
                                bp.x += bp.vx;
                                bp.y += bp.vy;
                                bp.life *= 0.95;

                                if (bp.life < 0.01) {
                                    window.orbBurstParticles.splice(i, 1);
                                    continue;
                                }

                                context.beginPath();
                                context.arc(bp.x, bp.y, bp.size * bp.life, 0, Math.PI * 2);
                                context.fillStyle = rgbString + (bp.life * 0.8 * presentationVisibility) + ")";
                                context.fill();
                                
                                context.beginPath();
                                context.moveTo(bp.x, bp.y);
                                context.lineTo(projCenterX, projCenterY);
                                context.strokeStyle = rgbString + (bp.life * 0.2 * presentationVisibility) + ")";
                                context.lineWidth = 0.5;
                                context.stroke();
                            }
                        }

                        const cDist = Math.hypot(projX - projCenterX, projY - projCenterY);
                        const maxCDist = sphereRad * projScale * 0.8;
                        if (cDist < maxCDist) {
                            context.beginPath();
                            context.moveTo(projX, projY);
                            context.lineTo(projCenterX, projCenterY);
                            const particleThreshold = Math.abs((p.x + p.y + p.z) % 1);
                            const angle = Math.atan2(p.y, p.x) + Math.PI;
                            const colorIndex = Math.floor((angle / (2 * Math.PI)) * multicolorPalette.length) % multicolorPalette.length;

                            let densityFade = 1;
                            if (window.isLowDensityActive) {
                                const maskNoise = Math.abs(Math.sin((p.x * 0.016) + (p.y * 0.021) + (p.z * 0.013) + window.lowDensityMaskSeed));
                                const keepFactor = 1 - (window.lowDensityStrength || 0) * (1 - (window.lowDensityMinFactor || 0.38));
                                densityFade = maskNoise < keepFactor ? 1 : 0;
                            }
                            const cAlpha = finalAlpha * (1 - cDist / maxCDist) * densityFade * presentationVisibility;

                            const localRecovery = window.localGreenRecovery ?? 0;
                            const localMask = Math.abs(Math.sin((p.x * 0.017) + (p.y * 0.019) + (p.z * 0.023) + 0.37));
                            const useRecoveredGreen = localRecovery > 0 && localMask < localRecovery;

                            const pinnedPoints = window.centerPinnedPoints || [];
                            const coverage = window.centerInflowCoverage || 0;
                            let pinnedColor = null;
                            if (pinnedPoints.length > 0 && coverage > 0) {
                                const pinNoise = Math.abs(Math.sin((p.x * 0.014) + (p.y * 0.017) + (p.z * 0.019) + 0.23));
                                if (pinNoise < coverage) {
                                    const pinIndex = Math.min(pinnedPoints.length - 1, Math.floor(pinNoise * pinnedPoints.length));
                                    pinnedColor = pinnedPoints[pinIndex] || null;
                                }
                            }

                            if (pinnedColor) {
                                const tuned = applyMessengerSectorBrightness(pinnedColor, cAlpha * (0.4 + audioVal * 0.6), angle);
                                context.strokeStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                            } else if (useRecoveredGreen) {
                                const tuned = applyMessengerSectorBrightness(baseOrbColor, cAlpha * (0.4 + audioVal * 0.6), angle);
                                context.strokeStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                            } else if (window.isMulticolor && (particleThreshold < window.multicolorIntensity)) {
                                const color = multicolorPalette[colorIndex];
                                const tuned = applyMessengerSectorBrightness(color, cAlpha * (0.4 + audioVal * 0.6), angle);
                                context.strokeStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                            } else {
                                const tuned = applyMessengerSectorBrightness({ r, g, b }, cAlpha * (0.4 + audioVal * 0.6), angle);
                                context.strokeStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                            }
                            
                            context.lineWidth = (0.3 + audioVal * 0.5) * cAlpha;
                            context.stroke();
                        }
                        context.shadowBlur = 0;

                        if (window.heroOrbMouseX !== undefined && window.heroOrbMouseY !== undefined) {
                            const mDist = Math.hypot(projX - window.heroOrbMouseX, projY - window.heroOrbMouseY);
                            const pushRadius = 100;
                            if (mDist < pushRadius) {
                                const pushForce = (1 - mDist / pushRadius) * 5;
                                const angle = Math.atan2(projY - window.heroOrbMouseY, projX - window.heroOrbMouseX);
                                projX += Math.cos(angle) * pushForce;
                                projY += Math.sin(angle) * pushForce;
                            }
                        }

                        let otherP = p.next;
                        let connections = 0;
                        const maxConnections = 3;
                        const maxPDist = 80;
                        
                        while (otherP != null && connections < maxConnections) {
                            if (Math.abs(p.z - otherP.z) < 150) {
                                let oLocalX = otherP.x - sphereCenterX, oLocalY = otherP.y - sphereCenterY, oLocalZ = otherP.z - sphereCenterZ;
                                let oRotated = rotatePoint(oLocalX, oLocalY, oLocalZ, targetAngleY, targetAngleX);
                                let oFinalZ = oRotated.z + sphereCenterZ;
                                let oProjScale = radius_sp * fLen / (fLen - oFinalZ);
                                let oProjX = (oRotated.x + sphereCenterX) * oProjScale + projCenterX;
                                let oProjY = (oRotated.y + sphereCenterY) * oProjScale + projCenterY;

                                const pDist = Math.hypot(projX - oProjX, projY - oProjY);
                                if (pDist < maxPDist) {
                                    context.beginPath();
                                    context.moveTo(projX, projY);
                                    context.lineTo(oProjX, oProjY);
                                    const particleThreshold = Math.abs((p.x + p.y + p.z) % 1);
                                    const angle = Math.atan2(p.y, p.x) + Math.PI;
                                    const colorIndex = Math.floor((angle / (2 * Math.PI)) * multicolorPalette.length) % multicolorPalette.length;

                                    let densityFade = 1;
                                    if (window.isLowDensityActive) {
                                        const maskNoise = Math.abs(Math.sin((p.x * 0.016) + (p.y * 0.021) + (p.z * 0.013) + window.lowDensityMaskSeed));
                                        const keepFactor = 1 - (window.lowDensityStrength || 0) * (1 - (window.lowDensityMinFactor || 0.38));
                                        densityFade = maskNoise < keepFactor ? 1 : 0;
                                    }
                                    const lineAlpha = finalAlpha * (1 - pDist / maxPDist) * densityFade * presentationVisibility;

                                    const localRecovery = window.localGreenRecovery ?? 0;
                                    const localMask = Math.abs(Math.sin((p.x * 0.017) + (p.y * 0.019) + (p.z * 0.023) + 0.37));
                                    const useRecoveredGreen = localRecovery > 0 && localMask < localRecovery;

                                    const pinnedPoints = window.centerPinnedPoints || [];
                                    const coverage = window.centerInflowCoverage || 0;
                                    let pinnedColor = null;
                                    if (pinnedPoints.length > 0 && coverage > 0) {
                                        const pinNoise = Math.abs(Math.sin((p.x * 0.014) + (p.y * 0.017) + (p.z * 0.019) + 0.23));
                                        if (pinNoise < coverage) {
                                            const pinIndex = Math.min(pinnedPoints.length - 1, Math.floor(pinNoise * pinnedPoints.length));
                                            pinnedColor = pinnedPoints[pinIndex] || null;
                                        }
                                    }

                                    if (pinnedColor) {
                                        const tuned = applyMessengerSectorBrightness(pinnedColor, lineAlpha * 0.4, angle);
                                        context.strokeStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                                    } else if (useRecoveredGreen) {
                                        const tuned = applyMessengerSectorBrightness(baseOrbColor, lineAlpha * 0.4, angle);
                                        context.strokeStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                                    } else if (window.isMulticolor && (particleThreshold < window.multicolorIntensity)) {
                                        const color = multicolorPalette[colorIndex];
                                        const tuned = applyMessengerSectorBrightness(color, lineAlpha * 0.4, angle);
                                        context.strokeStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                                    } else {
                                        const tuned = applyMessengerSectorBrightness({ r, g, b }, lineAlpha * 0.4, angle);
                                        context.strokeStyle = `rgba(${tuned.color.r}, ${tuned.color.g}, ${tuned.color.b}, ${tuned.alpha})`;
                                    }

                                    context.lineWidth = 0.4 * lineAlpha;
                                    context.stroke();
                                    connections++;
                                }
                            }
                            otherP = otherP.next;
                        }
                    }
                    p = nextParticle;
                }

                if (window.isCenterInflowActive) {
                    if (!window.centerInflowParticles) window.centerInflowParticles = [];
                    if (!window.centerPinnedPoints) window.centerPinnedPoints = [];

                    const inflowStrength = window.centerInflowStrength || 0;
                    const palette = multicolorPalette;
                    const sourceRadius = Math.max(displayWidth, displayHeight) * 0.7;
                    const targetRadius = Math.max(sphereRad * 0.75, 120);

                    window.centerInflowSpawnAccumulator += 0.2 + inflowStrength * 1.25;
                    while (window.centerInflowSpawnAccumulator >= 1) {
                        window.centerInflowSpawnAccumulator -= 1;
                        const streamAngle = Math.random() * Math.PI * 2;
                        const startX = projCenterX + Math.cos(streamAngle) * sourceRadius;
                        const startY = projCenterY + Math.sin(streamAngle) * sourceRadius;
                        const targetAngle = streamAngle + (Math.random() - 0.5) * 0.65;
                        const targetX = projCenterX + Math.cos(targetAngle) * targetRadius;
                        const targetY = projCenterY + Math.sin(targetAngle) * targetRadius;
                        const color = palette[Math.floor(Math.random() * palette.length)];

                        window.centerInflowParticles.push({
                            x: startX,
                            y: startY,
                            tx: targetX,
                            ty: targetY,
                            vx: (targetX - startX) * (0.007 + Math.random() * 0.006),
                            vy: (targetY - startY) * (0.007 + Math.random() * 0.006),
                            life: 1,
                            color
                        });
                    }

                    for (let i = window.centerInflowParticles.length - 1; i >= 0; i--) {
                        const sp = window.centerInflowParticles[i];
                        sp.x += sp.vx;
                        sp.y += sp.vy;
                        sp.vx *= 1.012;
                        sp.vy *= 1.012;

                        const dx = sp.tx - sp.x;
                        const dy = sp.ty - sp.y;
                        const dist = Math.hypot(dx, dy);

                        context.beginPath();
                        context.arc(sp.x, sp.y, 1.1 + inflowStrength * 1.6, 0, Math.PI * 2);
                        context.fillStyle = `rgba(${sp.color.r}, ${sp.color.g}, ${sp.color.b}, ${0.22 + inflowStrength * 0.5})`;
                        context.fill();

                        if (dist < 16) {
                            if (window.centerPinnedPoints.length < 1100) {
                                window.centerPinnedPoints.push(sp.color);
                            } else {
                                const replaceAt = Math.floor(Math.random() * window.centerPinnedPoints.length);
                                window.centerPinnedPoints[replaceAt] = sp.color;
                            }

                            window.centerInflowHitCount = (window.centerInflowHitCount || 0) + 1;
                            const targetCoverage = Math.min(1, (window.centerInflowHitCount || 0) / 120);
                            window.centerInflowCoverage = Math.max(window.centerInflowCoverage || 0, targetCoverage);

                            window.centerInflowParticles.splice(i, 1);
                        } else if (
                            sp.x < -80 || sp.x > displayWidth + 80 ||
                            sp.y < -80 || sp.y > displayHeight + 80
                        ) {
                            window.centerInflowParticles.splice(i, 1);
                        }
                    }
                } else {
                    window.centerInflowParticles = [];
                    window.centerInflowSpawnAccumulator = 0;

                    if (window.localGreenRecovery > 0) {
                        const keepRatio = Math.max(0, 1 - window.localGreenRecovery);
                        const targetLen = Math.floor((window.centerPinnedPoints || []).length * keepRatio);
                        if (window.centerPinnedPoints && window.centerPinnedPoints.length > targetLen) {
                            window.centerPinnedPoints.length = targetLen;
                        }
                        window.centerInflowCoverage = (window.centerInflowCoverage || 0) * keepRatio;
                    } else {
                        window.centerPinnedPoints = [];
                        window.centerInflowHitCount = 0;
                        window.centerInflowCoverage = 0;
                    }
                }

            }

            window.updateSphereMouse = function(deltaX, deltaY) {
                mouseIdle = false;
                lastMouseMoveTime = Date.now();
                targetAngleY += deltaX * 0.012;
                targetAngleX += deltaY * 0.008;
                if (targetAngleX > Math.PI / 2.1) targetAngleX = Math.PI / 2.1;
                if (targetAngleX < -Math.PI / 2.1) targetAngleX = -Math.PI / 2.1;
            };
            initSphere();
        })();

        function initHeroOrb() {
            const container = document.querySelector('.cl-hero-orb-container');
            if (!container) return;
            let currentX = 0, currentY = 0;
            let mouseTargetX = 0, mouseTargetY = 0;
            let zoneTargetX = 0, zoneTargetY = 0;
            let nextZoneTime = 0, zoneStudyUntil = 0;
            let studyRadius = 0, studySpeed = 0;

            function updateMouseTarget(clientX, clientY) {
                mouseTargetX = clientX - window.innerWidth / 2;
                mouseTargetY = clientY - window.innerHeight / 2;
                window.heroOrbMouseActiveUntil = performance.now() + 1500;
            }

            window.addEventListener('mousemove', (e) => {
                mouseTargetX = e.clientX - window.innerWidth / 2;
                mouseTargetY = e.clientY - window.innerHeight / 2;
                window.heroOrbMouseX = e.clientX;
                window.heroOrbMouseY = e.clientY;
                window.heroOrbMouseActiveUntil = performance.now() + 2000;
            });

            function pickNewZone(now) {
                zoneTargetX = (Math.random() - 0.5) * window.innerWidth * 0.9;
                zoneTargetY = (Math.random() - 0.5) * window.innerHeight * 0.9;
                zoneStudyUntil = now + 800 + Math.random() * 1700;
                studyRadius = 20 + Math.random() * 80;
                studySpeed = 0.002 + Math.random() * 0.005;
                nextZoneTime = zoneStudyUntil + 600 + Math.random() * 1400;
            }

            function animate(now) {
                let desiredX, desiredY, lerpFactor;
                const mouseIsActive = performance.now() < window.heroOrbMouseActiveUntil;
                const audioVal = window.currentAudioVolume || 0;

                if (window.presentationModeActive) {
                    desiredX = 0;
                    desiredY = 0;
                    lerpFactor = 0.05;

                    currentX += (desiredX - currentX) * lerpFactor;
                    currentY += (desiredY - currentY) * lerpFactor;

                    const scale = 1.0 + (audioVal * 0.15);

                    let shakeX = 0;
                    let shakeY = 0;
                    if (audioVal > 0.1) {
                        shakeX = (Math.random() - 0.5) * (audioVal * 0.55);
                        shakeY = (Math.random() - 0.5) * (audioVal * 0.55);
                    }


                    container.style.transform = `translate(calc(-50% + ${currentX + shakeX}px), calc(-50% + ${currentY + shakeY}px)) scale(${scale})`;
                    container.style.opacity = 0.8 + (audioVal * 0.1);
                    container.style.filter = 'none';
                } else {
                    if (mouseIsActive) {
                        desiredX = mouseTargetX; desiredY = mouseTargetY; lerpFactor = 0.06;
                    } else {
                        if (nextZoneTime === 0 || now > nextZoneTime) pickNewZone(now);
                        if (now < zoneStudyUntil) {
                            desiredX = zoneTargetX + Math.sin(now * studySpeed) * studyRadius;
                            desiredY = zoneTargetY + Math.cos(now * studySpeed * 1.3) * studyRadius;
                            lerpFactor = 0.12;
                        } else {
                            desiredX = zoneTargetX; desiredY = zoneTargetY; lerpFactor = 0.03;
                        }
                    }
                    currentX += (desiredX - currentX) * lerpFactor;
                    currentY += (desiredY - currentY) * lerpFactor;
                    container.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px)) scale(1)`;
                    container.style.opacity = 0.8;
                }
                requestAnimationFrame(animate);
            }
            requestAnimationFrame(animate);
        }
        initHeroOrb();

        const startBtn = document.getElementById('start-presentation');

        const presentationAudioUrl = '/api/chat/static/videopresentation/audioindex.mp3';
        window.presentationAudio = null;

        const progressInput = document.getElementById('pres-progress');
        const currentTimeEl = document.getElementById('pres-current-time');
        const remainingTimeEl = document.getElementById('pres-remaining-time');
        let isSeekingPresentation = false;
        let presentationUiHideTimer = null;
        const PRESENTATION_UI_HIDE_MS = 4000;

        function clearPresentationUiHideTimer() {
            if (presentationUiHideTimer) {
                clearTimeout(presentationUiHideTimer);
                presentationUiHideTimer = null;
            }
        }

        function showPresentationUi() {
            if (!window.presentationModeActive) return;
            document.body.classList.remove('presentation-ui-hidden');
        }

        function schedulePresentationUiHide() {
            clearPresentationUiHideTimer();
            if (!window.presentationModeActive || isSeekingPresentation) return;
            presentationUiHideTimer = setTimeout(() => {
                if (!window.presentationModeActive || isSeekingPresentation) return;
                document.body.classList.add('presentation-ui-hidden');
            }, PRESENTATION_UI_HIDE_MS);
        }

        function bumpPresentationUiActivity() {
            showPresentationUi();
            schedulePresentationUiHide();
        }

        function bindPresentationUiActivityEvents() {
            const onActivity = () => {
                if (!window.presentationModeActive) return;
                bumpPresentationUiActivity();
            };

            document.addEventListener('pointermove', onActivity, { passive: true });
            document.addEventListener('pointerdown', onActivity, { passive: true });
            document.addEventListener('touchstart', onActivity, { passive: true });
            document.addEventListener('keydown', onActivity);
        }

        bindPresentationUiActivityEvents();

        function recoverPresentationAudioIfNeeded() {
            const audio = window.presentationAudio;
            if (!audio || !window.presentationModeActive) return;
            if (typeof window.resumePresentationAudioContext === 'function') {
                window.resumePresentationAudioContext();
            }
            if (!audio.paused && audio.muted) {
                audio.muted = false;
            }
        }

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                recoverPresentationAudioIfNeeded();
            }
        });
        window.addEventListener('focus', recoverPresentationAudioIfNeeded);
        window.addEventListener('pageshow', recoverPresentationAudioIfNeeded);

        function setPresentationAudioPlayingState(isPlaying) {
            document.body.classList.toggle('presentation-audio-playing', Boolean(isPlaying));
        }

        function formatPresentationTime(totalSeconds) {
            const safe = Math.max(0, Math.floor(totalSeconds || 0));
            const minutes = Math.floor(safe / 60);
            const seconds = safe % 60;
            return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        function updatePresentationTimeline() {
            const audio = window.presentationAudio;
            if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
                if (progressInput && !isSeekingPresentation) {
                    progressInput.value = '0';
                }
                if (currentTimeEl) currentTimeEl.textContent = '00:00';
                if (remainingTimeEl) remainingTimeEl.textContent = '-00:00';
                return;
            }

            const duration = audio.duration;
            const current = Math.min(Math.max(audio.currentTime || 0, 0), duration);
            const remaining = Math.max(duration - current, 0);

            if (progressInput && !isSeekingPresentation) {
                progressInput.max = String(duration);
                progressInput.value = String(current);
            }

            if (currentTimeEl) currentTimeEl.textContent = formatPresentationTime(current);
            if (remainingTimeEl) remainingTimeEl.textContent = `-${formatPresentationTime(remaining)}`;
        }

        function resetPresentationTimeline() {
            if (progressInput) {
                progressInput.max = '100';
                progressInput.value = '0';
            }
            if (currentTimeEl) currentTimeEl.textContent = '00:00';
            if (remainingTimeEl) remainingTimeEl.textContent = '-00:00';
            isSeekingPresentation = false;
            document.body.classList.remove('presentation-ui-hidden');
            clearPresentationUiHideTimer();
            setPresentationAudioPlayingState(false);
        }

        function finishPresentation() {
            window.presentationModeActive = false;
            window.isMulticolor = false;
            window.multicolorIntensity = 0;
            window.isLowDensityActive = false;
            window.lowDensityStrength = 0;
            window.isExplosionActive = false;
            window.explosionTriggered = false;
            window.isReassembleActive = false;
            window.reassembleStrength = 0;
            window.explosionBlend = 0;
            window.isFlowStreamActive = false;
            window.flowStreamStrength = 0;
            window.flowStreamDrift = 0;
            window.flowStreamWobble = 0;
            window.isCenterInflowActive = false;
            window.centerInflowStrength = 0;
            window.centerInflowParticles = [];
            window.centerPinnedPoints = [];
            window.centerInflowSpawnAccumulator = 0;
            window.centerInflowHitCount = 0;
            window.centerInflowCoverage = 0;
            window.isMessengerSectorActive = false;
            window.messengerSectorStrength = 0;
            window.messengerSectorPhase = 0;
            window.orbPresentationAlpha = 1;
            window.orbBlinkFactor = 1;
            window.orbRedBlend = 0;
            window.redDotsVisibility = 1;
            window.redDotsSectorFade = 0;
            window.orbSphereScale = 1;
            window.orbSphereScaleTarget = 1;
            window.localGreenRecovery = 0;
            if (typeof window.setOrbColor === 'function' && window.baseOrbColor) {
                window.setOrbColor(window.baseOrbColor.r, window.baseOrbColor.g, window.baseOrbColor.b);
            }
            document.body.classList.remove('presentation-mode');


            document.body.classList.remove('presentation-ui-hidden');
            clearPresentationUiHideTimer();

            if (window.presentationAudio) {
                window.presentationAudio.pause();
                window.presentationAudio.currentTime = 0;
                window.presentationAudio = null;
            }

            if (typeof window.stopAudioAnalysis === 'function') {
                window.stopAudioAnalysis();
            }

            resetPresentationTimeline();

            const indexOverlay = document.getElementById('presentation-overlay');
            if (indexOverlay) {
                indexOverlay.style.opacity = '0';
                indexOverlay.style.pointerEvents = 'none';
            }

            const hero = document.querySelector('.hero');
            if (hero) {
                hero.style.display = 'flex';
                const elements = hero.querySelectorAll('h1, p, .cta-group');
                elements.forEach(el => {
                    el.style.opacity = '1';
                    el.style.visibility = 'visible';
                    el.style.pointerEvents = 'auto';
                });
            }
        }

        const toggleBtn = document.getElementById('pres-toggle-play');
        const exitBtn = document.getElementById('pres-exit');

        if (progressInput) {
            let resumeAfterSeek = false;

            const applySeekValue = (rawValue) => {
                if (!window.presentationAudio) return;
                const next = Number(rawValue);
                if (!Number.isFinite(next)) return;

                const duration = window.presentationAudio.duration;
                const safeNext = Number.isFinite(duration)
                    ? Math.min(Math.max(next, 0), duration)
                    : Math.max(next, 0);

                window.presentationAudio.currentTime = safeNext;
                updatePresentationTimeline();
            };

            const beginSeek = () => {
                if (isSeekingPresentation) return;
                isSeekingPresentation = true;
                showPresentationUi();
                clearPresentationUiHideTimer();

                const audio = window.presentationAudio;
                resumeAfterSeek = Boolean(audio && !audio.paused && !audio.ended);
                if (resumeAfterSeek) {
                    audio.pause();
                }
            };

            const endSeek = async () => {
                if (!isSeekingPresentation) return;
                isSeekingPresentation = false;
                updatePresentationTimeline();

                if (resumeAfterSeek && window.presentationAudio && window.presentationModeActive) {
                    resumeAfterSeek = false;
                    try {
                        await window.presentationAudio.play();
                    } catch (_) {
                        setPresentationAudioPlayingState(false);
                    }
                } else {
                    resumeAfterSeek = false;
                }

                if (window.presentationModeActive) {
                    schedulePresentationUiHide();
                }
            };

            progressInput.addEventListener('pointerdown', () => {
                bumpPresentationUiActivity();
                beginSeek();
            });
            progressInput.addEventListener('input', (event) => {
                bumpPresentationUiActivity();
                beginSeek();
                applySeekValue(event.target.value);
            });
            progressInput.addEventListener('change', (event) => {
                bumpPresentationUiActivity();
                applySeekValue(event.target.value);
                void endSeek();
            });

            document.addEventListener('pointerup', () => { void endSeek(); });
            document.addEventListener('pointercancel', () => { void endSeek(); });
            window.addEventListener('blur', () => { void endSeek(); });
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                if (!window.presentationAudio) return;
                bumpPresentationUiActivity();

                const iconPause = toggleBtn.querySelector('.icon-pause');
                const iconPlay = toggleBtn.querySelector('.icon-play');

                    if (window.presentationAudio.paused) {
                    window.presentationAudio.play();
                    if (iconPause) iconPause.style.display = 'block';
                    if (iconPlay) iconPlay.style.display = 'none';
                    setPresentationAudioPlayingState(true);
                } else {
                    window.presentationAudio.pause();
                    if (iconPause) iconPause.style.display = 'none';
                    if (iconPlay) iconPlay.style.display = 'block';
                    setPresentationAudioPlayingState(false);
                }

                updatePresentationTimeline();
            });
        }

        if (exitBtn) {
            exitBtn.addEventListener('click', () => {
                bumpPresentationUiActivity();
                finishPresentation();
            });
        }

        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                console.log('Presentation button clicked');

                if (window.presentationAudio) {
                    window.presentationAudio.pause();
                    window.presentationAudio.currentTime = 0;
                    window.presentationAudio = null;
                }

                window.presentationModeActive = true;
                document.body.classList.add('presentation-mode');
                showPresentationUi();
                schedulePresentationUiHide();

                if (toggleBtn) {
                    const iconPause = toggleBtn.querySelector('.icon-pause');
                    const iconPlay = toggleBtn.querySelector('.icon-play');
                    if (iconPause) iconPause.style.display = 'block';
                    if (iconPlay) iconPlay.style.display = 'none';
                }

                const audio = new Audio(presentationAudioUrl);
                audio.preload = 'auto';
                audio.crossOrigin = 'anonymous';
                window.presentationAudio = audio;

                audio.onloadedmetadata = () => {
                    if (progressInput && Number.isFinite(audio.duration) && audio.duration > 0) {
                        progressInput.max = String(audio.duration);
                    }
                    updatePresentationTimeline();
                };
                audio.ontimeupdate = () => {
                    updatePresentationTimeline();
                    
                    const time = audio.currentTime;
                    const start = 3.5;
                    const colorFadeStart = 19.0;
                    const colorFadeEnd = 22.0;
                    const fadeDuration = 2.0;

                    const densityStart = 12.0;
                    const densityEnd = 15.0;
                    const restoreEnd = 18.0;

                    if (time >= densityStart && time < densityEnd) {
                        window.isLowDensityActive = true;
                        window.lowDensityStrength = (time - densityStart) / (densityEnd - densityStart);
                    } else if (time >= densityEnd && time < restoreEnd) {
                        window.isLowDensityActive = true;
                        window.lowDensityStrength = 1 - ((time - densityEnd) / (restoreEnd - densityEnd));
                    } else {
                        window.isLowDensityActive = false;
                        window.lowDensityStrength = 0;
                    }

                    window.isExplosionActive = false;
                    window.isReassembleActive = false;
                    window.explosionBlend = 0;
                    window.explosionTriggered = false;
                    window.reassembleStrength = 0;

                    if (time > start && time < colorFadeStart) {
                        window.isMulticolor = true;
                        if (time < start + fadeDuration) {
                            window.multicolorIntensity = (time - start) / fadeDuration;
                        } else {
                            window.multicolorIntensity = 1;
                        }
                    } else if (time >= colorFadeStart && time < colorFadeEnd) {
                        window.isMulticolor = true;
                        window.multicolorIntensity = 1 - ((time - colorFadeStart) / (colorFadeEnd - colorFadeStart));
                    } else {
                        window.multicolorIntensity = 0;
                        window.isMulticolor = false;
                    }

                    const smoothStep = (value) => {
                        const t = Math.max(0, Math.min(1, value));
                        return t * t * (3 - 2 * t);
                    };
                    const smootherStep = (value) => {
                        const t = Math.max(0, Math.min(1, value));
                        return t * t * t * (t * (t * 6 - 15) + 10);
                    };

                    const redStart = 20.0;
                    const redFull = 22.0;
                    const recoverStart = 28.0;
                    const recoverEnd = 30.0;

                    let toRed = 0;
                    if (time >= redStart && time < redFull) {
                        toRed = smoothStep((time - redStart) / (redFull - redStart));
                    } else if (time >= redFull) {
                        toRed = 1;
                    }

                    let backToGreen = 0;
                    if (time >= recoverStart && time < recoverEnd) {
                        backToGreen = smootherStep((time - recoverStart) / (recoverEnd - recoverStart));
                    } else if (time >= recoverEnd) {
                        backToGreen = 1;
                    }

                    const redBlend = toRed * (1 - backToGreen);
                    window.orbRedBlend = redBlend;

                    const redDotsPreHideStart = 23.4;
                    const redDotsHideStart = 24.0;
                    if (time >= redDotsPreHideStart && time < redDotsHideStart) {
                        window.redDotsSectorFade = (time - redDotsPreHideStart) / (redDotsHideStart - redDotsPreHideStart);
                        window.redDotsVisibility = 1;
                    } else if (time >= redDotsHideStart && time < recoverStart) {
                        window.redDotsSectorFade = 1;
                        window.redDotsVisibility = 1;
                    } else if (time >= recoverStart && time < recoverEnd) {
                        const back = smootherStep((time - recoverStart) / (recoverEnd - recoverStart));
                        window.redDotsSectorFade = 1 - back;
                        window.redDotsVisibility = 1;
                    } else {
                        window.redDotsSectorFade = 0;
                        window.redDotsVisibility = 1;
                    }

                    const baseColor = window.baseOrbColor || { r: 112, g: 255, b: 140 };
                    const targetRed = window.redOrbColor || { r: 255, g: 77, b: 77 };
                    const mixedR = baseColor.r + (targetRed.r - baseColor.r) * redBlend;
                    const mixedG = baseColor.g + (targetRed.g - baseColor.g) * redBlend;
                    const mixedB = baseColor.b + (targetRed.b - baseColor.b) * redBlend;
                    if (typeof window.setOrbColor === 'function') {
                        window.setOrbColor(mixedR, mixedG, mixedB);
                    }

                    window.orbSphereScaleTarget = 1;

                    const centerInflowStart = 37.0;
                    const centerInflowPeak = 46.0;
                    const centerInflowEnd = 58.0;
                    if (time >= centerInflowStart && time < centerInflowEnd) {
                        window.isCenterInflowActive = true;
                        if (time < centerInflowPeak) {
                            window.centerInflowStrength = smootherStep((time - centerInflowStart) / (centerInflowPeak - centerInflowStart));
                        } else {
                            const fade = smootherStep((time - centerInflowPeak) / (centerInflowEnd - centerInflowPeak));
                            window.centerInflowStrength = 1 - fade * 0.2;
                        }
                    } else {
                        window.isCenterInflowActive = false;
                        window.centerInflowStrength = 0;
                    }

                    const messengerSectorStart = 58.0;
                    const messengerSectorEnd = 76.0;
                    if (time >= messengerSectorStart && time < messengerSectorEnd) {
                        const totalProgress = (time - messengerSectorStart) / (messengerSectorEnd - messengerSectorStart);
                        const phase = totalProgress * 8;
                        window.isMessengerSectorActive = true;
                        window.messengerSectorPhase = phase;
                        const intro = Math.min(1, totalProgress / 0.2);
                        const outro = Math.min(1, Math.max(0, (totalProgress - 0.85) / 0.15));
                        window.messengerSectorStrength = intro * (1 - 0.7 * outro);
                    } else {
                        window.isMessengerSectorActive = false;
                        window.messengerSectorStrength = 0;
                    }

                    if (time >= recoverStart && time < recoverEnd) {
                        window.localGreenRecovery = smootherStep((time - recoverStart) / (recoverEnd - recoverStart));
                    } else if (time >= recoverEnd) {
                        window.localGreenRecovery = 1;
                    } else {
                        window.localGreenRecovery = 0;
                    }

                    window.orbBlinkFactor = 1;
                    window.orbPresentationAlpha = 1;
                };

                audio.ondurationchange = updatePresentationTimeline;
                audio.onplay = () => {
                    if (typeof window.resumePresentationAudioContext === 'function') {
                        window.resumePresentationAudioContext();
                    }
                    setPresentationAudioPlayingState(true);
                };
                audio.onpause = () => {
                    if (isSeekingPresentation) {
                        return;
                    }
                    if (!audio.ended) {
                        setPresentationAudioPlayingState(false);
                    }
                };

                audio.onended = () => {
                    if (!window.presentationModeActive) return;
                    finishPresentation();
                };

                audio.onerror = () => {
                    console.error('Presentation audio failed to load:', presentationAudioUrl);
                    finishPresentation();
                };

                if (typeof window.setupAudioAnalysis === 'function') {
                    window.setupAudioAnalysis(audio);
                }

                try {
                    await audio.play();
                    setPresentationAudioPlayingState(true);
                    updatePresentationTimeline();
                } catch (err) {
                    console.warn('Autoplay blocked or failed:', err);
                    finishPresentation();
                }
            });
        }

        window.addEventListener('mitya-presentation-stopped', () => {
            console.log('Presentation stopped');
            finishPresentation();
        });
