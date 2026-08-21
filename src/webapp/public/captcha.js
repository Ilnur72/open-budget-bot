(function () {
        'use strict';

        var tg = window.Telegram && window.Telegram.WebApp;

        // ---- Doimiylar (server tomonidagi validatsiya bilan bir xil) ----
        var API_URL = '/api/captcha';
        // openbudget.uz captchasi AYNAN 2 ta nuqta kutadi (sahifadagi `const c = 2`).
        var REQUIRED_POINTS = 2;
        var MAX_POINTS = REQUIRED_POINTS;
        // Rasm B ning haqiqiy o'lchami 345x230; koordinatalar shu fazoda bo'ladi.
        var MAX_COORDINATE = 10000;
        // Captcha shuncha vaqtdan keyin eskiradi (saytdagi `let t = 30000`).
        var CAPTCHA_LIFETIME_MS = 30000;
        var REQUEST_TIMEOUT_MS = 20000;
        var STEP = 0.02; // klaviatura qadami (rasm kengligining ulushi)
        var FINE_STEP = 0.005; // Shift bilan aniq qadam

        // ---- DOM ----
        var el = {
          loading: document.getElementById('screen-loading'),
          error: document.getElementById('screen-error'),
          captcha: document.getElementById('screen-captcha'),
          done: document.getElementById('screen-done'),
          errorTitle: document.getElementById('errorTitle'),
          errorHint: document.getElementById('errorHint'),
          retryBtn: document.getElementById('retryBtn'),
          closeBtn: document.getElementById('closeBtn'),
          imageA: document.getElementById('imageA'),
          imageB: document.getElementById('imageB'),
          picker: document.getElementById('picker'),
          loupe: document.getElementById('loupe'),
          crosshair: document.getElementById('crosshair'),
          markers: document.getElementById('markers'),
          undoBtn: document.getElementById('undoBtn'),
          clearBtn: document.getElementById('clearBtn'),
          pointStatus: document.getElementById('pointStatus'),
        };

        // ---- Holat ----
        // points: { rx, ry, x, y } — rx/ry nisbiy (0..1, ekran o'lchami o'zgarsa ham to'g'ri
        // qoladi), x/y esa serverga ketadigan ORIGINAL piksel koordinatalari.
        var points = [];
        var crosshairPos = { rx: 0.5, ry: 0.5 };
        var isSubmitting = false;
        var loadToken = 0; // eskirgan javob yangisini bosib ketmasligi uchun
        var activeController = null;

        // ---------- Yordamchilar ----------

        function clamp(value, min, max) {
          return Math.min(max, Math.max(min, value));
        }

        /** Telegram API'lari eski mijozlarda bo'lmasligi mumkin — chaqiruvni himoyalaymiz. */
        function safe(fn) {
          try {
            fn();
          } catch (e) {
            /* eski mijoz — jim o'tkazamiz */
          }
        }

        function showScreen(name) {
          el.loading.hidden = name !== 'loading';
          el.error.hidden = name !== 'error';
          el.captcha.hidden = name !== 'captcha';
          el.done.hidden = name !== 'done';
        }

        /**
         * Serverdan kelgan rasm qiymatini <img src> uchun xavfsiz satrga aylantiradi.
         * Qo'llab-quvvatlanadi: data URI va toza base64 (prefiksni o'zimiz qo'shamiz).
         * Boshqa har qanday sxema (masalan `javascript:`) rad etiladi — bundan tashqari
         * server CSP'si ham `img-src 'self' data:` bilan tashqi rasmni to'sadi.
         */
        function toImageSrc(raw) {
          if (typeof raw !== 'string') {
            return null;
          }
          var value = raw.trim();
          if (value === '') {
            return null;
          }
          if (/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i.test(value)) {
            return value;
          }
          if (/^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 32) {
            // Server prefikssiz base64 yuborgan — prefiksni o'zimiz qo'shamiz.
            return 'data:image/png;base64,' + value.replace(/\s+/g, '');
          }
          return null;
        }

        function loadImage(imgEl, src) {
          return new Promise(function (resolve, reject) {
            imgEl.onload = function () {
              resolve();
            };
            imgEl.onerror = function () {
              reject(new Error('IMAGE_LOAD_FAILED'));
            };
            imgEl.src = src;
          });
        }

        function showError(title, hint, canRetry) {
          showScreen('error');
          el.errorTitle.textContent = title;
          el.errorHint.textContent = hint;
          el.retryBtn.hidden = !canRetry;
          safe(function () {
            tg.MainButton.hideProgress();
            tg.MainButton.hide();
          });
        }

        // ---------- Nuqtalar ----------

        function renderMarkers() {
          el.markers.textContent = '';
          for (var i = 0; i < points.length; i += 1) {
            var marker = document.createElement('div');
            marker.className = 'marker';
            marker.style.left = points[i].rx * 100 + '%';
            marker.style.top = points[i].ry * 100 + '%';
            // Raqam: rang yagona belgi bo'lib qolmasin va nuqtalar farqlansin.
            marker.textContent = String(i + 1);
            el.markers.appendChild(marker);
          }
        }

        function updateStatus(message, kind) {
          el.pointStatus.className = 'status' + (kind ? ' ' + kind : '');
          el.pointStatus.textContent = message;
        }

        function syncUi(message, kind) {
          renderMarkers();
          el.undoBtn.disabled = points.length === 0;
          el.clearBtn.disabled = points.length === 0;

          if (message) {
            updateStatus(message, kind);
          } else if (points.length === 0) {
            updateStatus('Hali nuqta belgilanmagan.', null);
          } else if (points.length < REQUIRED_POINTS) {
            updateStatus(
              'Belgilandi: ' +
                points.length +
                '/' +
                REQUIRED_POINTS +
                '. Yana ' +
                (REQUIRED_POINTS - points.length) +
                ' ta nuqta belgilang.',
              null,
            );
          } else {
            updateStatus(
              REQUIRED_POINTS + ' ta nuqta belgilandi. Tasdiqlash tugmasini bosing.',
              'success',
            );
          }

          syncMainButton();
        }

        function syncMainButton() {
          if (!tg || isSubmitting) {
            return;
          }
          safe(function () {
            if (points.length < REQUIRED_POINTS) {
              // Sayt kam yoki ko'p nuqtani qabul qilmaydi — tugma faqat
              // aynan kerakli sonda faollashadi.
              tg.MainButton.hide();
            } else {
              tg.MainButton.setText('✅ Tasdiqlash');
              tg.MainButton.show();
            }
          });
        }

        /** Nisbiy koordinata (0..1) bo'yicha yangi nuqta qo'shadi. */
        function addPoint(rx, ry) {
          if (isSubmitting) {
            return;
          }
          if (points.length >= MAX_POINTS) {
            updateStatus(
              'Aynan ' +
                REQUIRED_POINTS +
                ' ta nuqta kerak. Yangi nuqta uchun avval bittasini o\'chiring.',
              'error',
            );
            return;
          }

          var naturalW = el.imageB.naturalWidth;
          var naturalH = el.imageB.naturalHeight;
          if (!naturalW || !naturalH) {
            updateStatus('Rasm hali to\'liq yuklanmadi. Bir lahza kuting.', 'error');
            return;
          }

          var safeRx = clamp(rx, 0, 1);
          var safeRy = clamp(ry, 0, 1);

          // ORIGINAL piksel koordinatasi, butun son va server chegarasida.
          var x = clamp(
            Math.round(safeRx * naturalW),
            0,
            Math.min(naturalW - 1, MAX_COORDINATE),
          );
          var y = clamp(
            Math.round(safeRy * naturalH),
            0,
            Math.min(naturalH - 1, MAX_COORDINATE),
          );

          points.push({ rx: safeRx, ry: safeRy, x: x, y: y });
          crosshairPos = { rx: safeRx, ry: safeRy };
          moveCrosshair(0, 0);

          safe(function () {
            tg.HapticFeedback.impactOccurred('light');
          });

          syncUi();
        }

        // ---------- Klaviatura nishoni ----------

        function moveCrosshair(dx, dy) {
          crosshairPos.rx = clamp(crosshairPos.rx + dx, 0, 1);
          crosshairPos.ry = clamp(crosshairPos.ry + dy, 0, 1);
          el.crosshair.style.left = crosshairPos.rx * 100 + '%';
          el.crosshair.style.top = crosshairPos.ry * 100 + '%';
        }

        function handlePickerKeydown(event) {
          var step = event.shiftKey ? FINE_STEP : STEP;
          var dx = 0;
          var dy = 0;

          if (event.key === 'ArrowLeft') {
            dx = -step;
          } else if (event.key === 'ArrowRight') {
            dx = step;
          } else if (event.key === 'ArrowUp') {
            dy = -step;
          } else if (event.key === 'ArrowDown') {
            dy = step;
          } else {
            return;
          }

          event.preventDefault(); // sahifa sakramasin
          el.picker.classList.add('kb-active');
          moveCrosshair(dx, dy);
        }

        /** Lupa kattalashtirish darajasi. */
        var LOUPE_ZOOM = 3;

        /**
         * Barmoq/sichqoncha ostidagi joyni kattalashtirib ko'rsatadi.
         *
         * Captcha nishonlari juda kichik (rasm 345x230), barmoq esa ularni
         * to'sib qo'yadi. Lupa aynan qayerga qo'yilishini ko'rsatadi —
         * bu ayniqsa yoshi katta foydalanuvchilar uchun muhim.
         */
        function showLoupe(clientX, clientY) {
          var rect = el.imageB.getBoundingClientRect();
          if (!rect.width || !rect.height || !el.loupe) {
            return;
          }

          var rx = clamp((clientX - rect.left) / rect.width, 0, 1);
          var ry = clamp((clientY - rect.top) / rect.height, 0, 1);

          var zoomedW = rect.width * LOUPE_ZOOM;
          var zoomedH = rect.height * LOUPE_ZOOM;
          var size = el.loupe.offsetWidth || 132;

          el.loupe.style.backgroundImage = 'url("' + el.imageB.src + '")';
          el.loupe.style.backgroundSize = zoomedW + 'px ' + zoomedH + 'px';
          el.loupe.style.backgroundPosition =
            size / 2 - rx * zoomedW + 'px ' + (size / 2 - ry * zoomedH) + 'px';

          el.loupe.style.left = rx * 100 + '%';
          el.loupe.style.top = ry * 100 + '%';
          el.loupe.classList.add('visible');
        }

        function hideLoupe() {
          if (el.loupe) {
            el.loupe.classList.remove('visible');
          }
        }

        function handlePickerClick(event) {
          // detail === 0 — klaviaturadan (Enter/Space) kelgan "click": clientX ishonchsiz,
          // shuning uchun nishon joylashuvidan foydalanamiz.
          if (event.detail === 0) {
            el.picker.classList.add('kb-active');
            moveCrosshair(0, 0);
            addPoint(crosshairPos.rx, crosshairPos.ry);
            return;
          }

          var rect = el.imageB.getBoundingClientRect();
          if (!rect.width || !rect.height) {
            return;
          }
          addPoint(
            (event.clientX - rect.left) / rect.width,
            (event.clientY - rect.top) / rect.height,
          );
        }

        // ---------- Yuborish ----------

        function submit() {
          if (isSubmitting) {
            return; // ikki marta bosishdan himoya
          }
          if (points.length === 0) {
            safe(function () {
              tg.showAlert('Avval B rasmda kamida bitta nuqtani belgilang.');
            });
            return;
          }

          isSubmitting = true;
          safe(function () {
            tg.MainButton.showProgress(true);
            tg.MainButton.disable();
          });
          el.undoBtn.disabled = true;
          el.clearBtn.disabled = true;

          // Botga FAQAT nuqtalar ketadi — sessiya serverda qoladi.
          var payload = { points: [] };
          for (var i = 0; i < points.length; i += 1) {
            payload.points.push({ x: points[i].x, y: points[i].y });
          }

          try {
            tg.sendData(JSON.stringify(payload));
            showScreen('done');
          } catch (e) {
            isSubmitting = false;
            safe(function () {
              tg.MainButton.hideProgress();
              tg.MainButton.enable();
            });
            syncUi('Yuborishda xatolik. Qaytadan urinib ko\'ring.', 'error');
          }
        }

        // ---------- Captchani yuklash ----------

        function loadCaptcha() {
          var token = (loadToken += 1);

          if (activeController) {
            activeController.abort(); // eski so'rov yangisini bosib ketmasin
          }
          var controller = new AbortController();
          activeController = controller;
          var timedOut = false;
          var timer = setTimeout(function () {
            timedOut = true;
            controller.abort();
          }, REQUEST_TIMEOUT_MS);

          showScreen('loading');
          safe(function () {
            tg.MainButton.hide();
          });

          fetch(API_URL, {
            method: 'GET',
            headers: {
              // Server foydalanuvchini AYNAN shu sarlavhadan aniqlaydi.
              'X-Telegram-Init-Data': tg && tg.initData ? tg.initData : '',
              Accept: 'application/json',
            },
            cache: 'no-store',
            credentials: 'omit',
            signal: controller.signal,
          })
            .then(function (response) {
              return response
                .json()
                .catch(function () {
                  return null;
                })
                .then(function (body) {
                  return { response: response, body: body };
                });
            })
            .then(function (result) {
              if (token !== loadToken) {
                return null; // eskirgan javob — e'tiborsiz qoldiramiz
              }
              return handleResponse(result.response, result.body, token);
            })
            .catch(function (error) {
              if (token !== loadToken) {
                return;
              }
              if (error && error.name === 'AbortError') {
                if (timedOut) {
                  showError(
                    'Internet juda sekin',
                    'Captcha yuklanmadi. Aloqani tekshirib, qayta urinib ko\'ring.',
                    true,
                  );
                }
                return;
              }
              if (error && error.message === 'IMAGE_LOAD_FAILED') {
                showError(
                  'Rasm ochilmadi',
                  'Captcha rasmini ko\'rsatib bo\'lmadi. Qayta urinib ko\'ring.',
                  true,
                );
                return;
              }
              showError(
                'Ulanib bo\'lmadi',
                'Serverga ulanishda xatolik. Qayta urinib ko\'ring.',
                true,
              );
            })
            .then(function () {
              clearTimeout(timer);
              if (activeController === controller) {
                activeController = null;
              }
            });
        }

        function handleResponse(response, body, token) {
          if (response.status === 401) {
            showError(
              'Sessiya tasdiqlanmadi',
              'Sahifani botdagi "Captcha yechish" tugmasi orqali oching.',
              false,
            );
            return null;
          }

          if (response.status === 404) {
            showError(
              'Sessiya muddati tugagan',
              'Botga qaytib /vote yozing va jarayonni qaytadan boshlang.',
              false,
            );
            return null;
          }

          if (response.status === 429) {
            showError(
              'Juda ko\'p urinish',
              'Biroz kutib, qaytadan urinib ko\'ring.',
              true,
            );
            return null;
          }

          if (!response.ok) {
            showError(
              'Captcha yuklanmadi',
              'Server javob bermadi (' + response.status + '). Qayta urinib ko\'ring.',
              true,
            );
            return null;
          }

          var srcA = toImageSrc(body && body.imageA);
          var srcB = toImageSrc(body && body.imageB);
          if (!srcA || !srcB) {
            showError(
              'Captcha rasmi kelmadi',
              'Server yaroqli rasm qaytarmadi. Qayta urinib ko\'ring.',
              true,
            );
            return null;
          }

          // Ikkala rasm ham to'liq yuklangandan keyingina UI ko'rsatiladi:
          // shunda sahifa "sakramaydi" va naturalWidth allaqachon mavjud bo'ladi.
          return Promise.all([loadImage(el.imageA, srcA), loadImage(el.imageB, srcB)]).then(
            function () {
              if (token !== loadToken) {
                return;
              }
              points = [];
              crosshairPos = { rx: 0.5, ry: 0.5 };
              moveCrosshair(0, 0);
              el.picker.classList.remove('kb-active');
              isSubmitting = false;
              showScreen('captcha');
              syncUi();
            },
          );
        }

        // ---------- Telegram sozlamalari ----------

        function setupTelegram() {
          if (!tg) {
            return;
          }
          safe(function () {
            tg.ready();
          });
          safe(function () {
            tg.expand();
          });
          safe(function () {
            tg.MainButton.hide();
            tg.MainButton.onClick(submit);
          });
          safe(function () {
            tg.BackButton.show();
            tg.BackButton.onClick(function () {
              tg.close();
            });
          });
        }

        // ---------- Hodisalar ----------

        el.picker.addEventListener('click', handlePickerClick);
        el.picker.addEventListener('keydown', handlePickerKeydown);
        el.picker.addEventListener('blur', function () {
          el.picker.classList.remove('kb-active');
        });
        el.picker.addEventListener('pointerdown', function (event) {
          el.picker.classList.remove('kb-active'); // sichqoncha/barmoq — nishon kerak emas
          showLoupe(event.clientX, event.clientY);
        });
        el.picker.addEventListener('pointermove', function (event) {
          // Faqat barmoq/sichqoncha bosilib turganda kuzatamiz.
          if (event.buttons !== 0 || event.pointerType === 'touch') {
            showLoupe(event.clientX, event.clientY);
          }
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (name) {
          el.picker.addEventListener(name, hideLoupe);
        });
        // Rasmni uzoq bosganda "saqlash" menyusi chiqmasin.
        el.picker.addEventListener('contextmenu', function (event) {
          event.preventDefault();
        });

        el.undoBtn.addEventListener('click', function () {
          if (isSubmitting || points.length === 0) {
            return;
          }
          points.pop();
          syncUi(
            points.length === 0
              ? 'Hamma nuqtalar o\'chirildi.'
              : 'Oxirgi nuqta o\'chirildi. Qolgani: ' + points.length + ' ta.',
            points.length === 0 ? null : 'success',
          );
        });

        el.clearBtn.addEventListener('click', function () {
          if (isSubmitting || points.length === 0) {
            return;
          }
          points = [];
          syncUi('Hamma nuqtalar o\'chirildi.', null);
        });

        el.retryBtn.addEventListener('click', function () {
          loadCaptcha();
        });

        el.closeBtn.addEventListener('click', function () {
          if (tg) {
            safe(function () {
              tg.close();
            });
          }
        });

        // ---------- Boshlash ----------

        if (!tg) {
          showError(
            'Telegram topilmadi',
            'Bu sahifa faqat Telegram ilovasi ichida ishlaydi. Botdagi tugmadan foydalaning.',
            false,
          );
          return;
        }

        setupTelegram();

        if (!tg.initData) {
          // initData bo'lmasa server 401 qaytaradi — so'rov qilmasdan darrov aytamiz.
          showError(
            'Sessiya tasdiqlanmadi',
            'Sahifani botdagi "Captcha yechish" tugmasi orqali oching.',
            false,
          );
          return;
        }

        loadCaptcha();
      })();
