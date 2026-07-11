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
            let numToAddEachFrame = 12;
            let wait = 1;
            let count = wait - 1;
            let particleList = {};
            let recycleBin = {};
            let r = 112, g = 255, b = 140;
            let rgbString = "rgba(" + r + "," + g + "," + b + ",";
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

            window.setupAudioAnalysis = function(audioElement) {
                if (audioAnalyser && audioElement === window.currentAudioElement) return;

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
                
                let audioVal = window.currentAudioVolume || 0;
                
                if (!mouseIdle && (now - lastMouseMoveTime > IDLE_DELAY_MS)) {
                    mouseIdle = true;
                    randomizeAutoMovement();
                }
                if (window.presentationModeActive) {
                    targetAngleY += 0.005;
                    targetAngleX = Math.sin(now * 0.001) * 0.2;
                    
                    const BASE_RADIUS = Math.min(window.innerWidth * 0.45, 550);       // Базовый радиус сферы
                    const VOICE_EXPANSION = BASE_RADIUS * 0.1;   // На сколько сфера расширяется частицами (разлет)
                    const CONTAINER_SCALE = 0.2;   // Сила масштабирования всего контейнера (0.2 = +20%)
                    const SHAKE_INTENSITY = 10;    // Максимальная амплитуда тряски в пикселях

                    sphereRad = BASE_RADIUS + (audioVal * VOICE_EXPANSION); 
                    
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
                }

                currentAngleY += (targetAngleY - currentAngleY) * FOLLOW_SPEED;
                currentAngleX += (targetAngleX - currentAngleX) * FOLLOW_SPEED;
                count++;
                if (count >= wait) { count = 0; generateParticles(); }
                context.clearRect(0, 0, displayWidth, displayHeight);
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
                        p.x += p.velX; p.y += p.velY; p.z += p.velZ;
                    }
                    let localX = p.x - sphereCenterX, localY = p.y - sphereCenterY, localZ = p.z - sphereCenterZ;
                    let rotatedLocal = rotatePoint(localX, localY, localZ, targetAngleY, targetAngleX);
                    let finalX = rotatedLocal.x + sphereCenterX, finalY = rotatedLocal.y + sphereCenterY, finalZ = rotatedLocal.z + sphereCenterZ;
                    let projScale = radius_sp * fLen / (fLen - finalZ);
                    let projX = finalX * projScale + projCenterX, projY = finalY * projScale + projCenterY;
                    if (p.age < p.attack + p.hold + p.decay) {
                        if (p.age < p.attack) p.alpha = (p.holdValue - p.initValue) / p.attack * p.age + p.initValue;
                        else if (p.age < p.attack + p.hold) p.alpha = p.holdValue;
                        else p.alpha = (p.lastValue - p.holdValue) / p.decay * (p.age - p.attack - p.hold) + p.holdValue;
                    } else { p.dead = true; }
                    if (projX > displayWidth || projX < 0 || projY < 0 || projY > displayHeight || finalZ > zMax || p.dead) {
                        recycle(p);
                    } else {
                        let depthAlpha = (1 - finalZ / zeroAlphaDepth);
                        depthAlpha = (depthAlpha > 1) ? 1 : ((depthAlpha < 0) ? 0 : depthAlpha);
                        const finalAlpha = depthAlpha * p.alpha;
                        
                        context.fillStyle = rgbString + finalAlpha + ")";
                        context.beginPath();
                        context.arc(projX, projY, projScale * particleRad, 0, 2 * Math.PI);
                        context.fill();

                        const audioVal = window.currentAudioVolume || 0;
                        if (p === particleList.first) {
                            const coreSize = 3 + (audioVal * 4);
                            context.fillStyle = rgbString + (0.8 + audioVal * 0.2) + ")";
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
                                context.strokeStyle = rgbString + w.alpha + ")";
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
                                context.fillStyle = rgbString + (bp.life * 0.8) + ")";
                                context.fill();
                                
                                context.beginPath();
                                context.moveTo(bp.x, bp.y);
                                context.lineTo(projCenterX, projCenterY);
                                context.strokeStyle = rgbString + (bp.life * 0.2) + ")";
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
                            const cAlpha = finalAlpha * (1 - cDist / maxCDist);
                            context.strokeStyle = rgbString + (cAlpha * (0.4 + audioVal * 0.6)) + ")";
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
                                    const lineAlpha = finalAlpha * (1 - pDist / maxPDist);
                                    context.strokeStyle = rgbString + (lineAlpha * 0.4) + ")";
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
        const presentationText = `Привет! Я Митя.
Я не просто чат-бот. Я создатель мультиплатформы по выращиванию умных ассистентов с искусственным интеллектом. По сути, это единый цифровой мозг с мультимодальным интерфейсом. Тут вы можете создать чат-бота, аудио-бота или видео-бота — это всё один бот, который легко настраивается без участия программиста и внедряется на ваш сайт в роли сотрудника вашей компании.

Благодаря моей экосистеме это доступно теперь каждому — без единой строчки написания програмного кода. Вы можете создавать неограниченное количество ботов с уникальным дизайном за пару кликов под ваш стиль. Цвета, размеры, кнопки, иконки — всё легко меняется в разделе «Внешний вид» панели управления. Вы можете добавлять кнопки быстрого доступа и назначать им сценарии.

При создании бота необходимо дать ему имя, придумать приветствие и написать ему роль в зависимости от вашей сферы деятельности и должности бота. Это делается очень просто в настройках панели управления интеллектом, где вы без труда справитесь с этим.

Раньше подобные технологии были доступны только крупным корпорациям, потому что разработка персонального бота с глубоким пониманием бизнеса стоила миллионы.
В отличие от обычных ботов, я использую собственную RAG-архитектуру и семантический поиск на базе векторных эмбеддингов. Вы просто даёте мне ссылку на сайт или загружаете внутренние документы. Мой индексатор ежедневно сканирует ваши ресурсы, поэтому я всегда в курсе актуальной информации.

Я понимаю не просто слова, а смысл вопроса. 

Мой модуль конверсии мягко подводит посетителя стать клиентом. Магазинам я обрабатываю возражения и помогаю выбрать и оформить товар. В услугах я информирую, рассчитываю сметы и записываю на приём 24 часа в сутки, пока вы отдыхаете. В агентствах я провожу первичные интервью, отбираю лучших кандидатов и помогаю клиентам заполнять сложные брифы.

Я не болею, не сплю, не ем, поэтому буду всегда представлять ваши интересы.

Но это ещё не всё!
В панели управления вы получите не просто логи чатов, а мощную аналитику, прогнозы, рекомендации по улучшению и развитию вашего бизнеса, а также контроль лидов с мгновенными уведомлениями в мессенджеры и анализ самых популярных запросов. Это начало новой эпохи, где высокие технологии доступны теперь каждому! Не тратьте время на рутину — регистрируйтесь, заходите в панель управления и создайте своего личного персонализированного AI-ассистента. А если что-то будет непонятно — просто спросите меня, я помогу разобраться!`;

        const presentationAudioUrl = '/api/chat/static/videopresentation/audioindex.wav';
        window.presentationAudio = null;

        function finishPresentation() {
            window.presentationModeActive = false;
            document.body.classList.remove('presentation-mode');

            if (window.presentationAudio) {
                window.presentationAudio.pause();
                window.presentationAudio.currentTime = 0;
                window.presentationAudio = null;
            }

            if (typeof window.stopAudioAnalysis === 'function') {
                window.stopAudioAnalysis();
            }

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

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                if (!window.presentationAudio) return;
                
                const iconPause = toggleBtn.querySelector('.icon-pause');
                const iconPlay = toggleBtn.querySelector('.icon-play');

                if (window.presentationAudio.paused) {
                    window.presentationAudio.play();
                    if (iconPause) iconPause.style.display = 'block';
                    if (iconPlay) iconPlay.style.display = 'none';
                } else {
                    window.presentationAudio.pause();
                    if (iconPause) iconPause.style.display = 'none';
                    if (iconPlay) iconPlay.style.display = 'block';
                }
            });
        }

        if (exitBtn) {
            exitBtn.addEventListener('click', () => {
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

                // Сбрасываем иконку на паузу при старте
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
