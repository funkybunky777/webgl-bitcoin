define([
        'jquery',
        'diffuseShader',
        'sphericalMapLMShader',
        'lMTableShader',
        'vignetteData',
        'utils/matrixUtils',
        'fullModel',
        'uncompressedTextureLoader',
        'compressedTextureLoader'
    ],
    function(
        $,
        DiffuseShader,
        SphericalMapLMShader,
        LMTableShader,
        VignetteData,
        MatrixUtils,
        FullModel,
        UncompressedTextureLoader,
        CompressedTextureLoader) {

        var
            shaderSphericalMapLM, shaderDiffuse, shaderLMTable,
            vignette,
            textureCoinsNormalMap, textureSphericalMap, textureCoinsLightMap, textureTable, textureTableLM,
            loadedItemsCount = 0,
            loaded = false,
            loader,
            matOrtho,
            mMMatrix, mVMatrix, mMVPMatrix, mProjMatrix,
            modelTable, modelCoins,
            angleYaw = 0,
            lastTime = 0,
            isETC1Supported;

        var coinModelType = '1', // 1, 2, 3
            coinNormalType = '1', // 1, 2, 3
            coinSphericalMap = 'gold2', // 'bronze', 'gold2', 'silver'
            tableTextureType = 'marble'; // 'granite', 'marble', 'wood3'

        var ITEMS_TO_LOAD = 7;
        var FLOAT_SIZE_BYTES = 4;
        var TRIANGLE_VERTICES_DATA_STRIDE_BYTES = 5 * FLOAT_SIZE_BYTES;
        var TRIANGLE_VERTICES_DATA_POS_OFFSET = 0;
        var TRIANGLE_VERTICES_DATA_UV_OFFSET = 3;
        var FOV_LANDSCAPE = 25.0;
        var FOV_PORTRAIT = 40.0;
        var YAW_COEFF_NORMAL = 150.0;

        function initGL(canvas) {
            var gl = null;

            try {
                gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                gl.viewportWidth = canvas.width;
                gl.viewportHeight = canvas.height;
                isETC1Supported = !!gl.getExtension('WEBGL_compressed_texture_etc1');
            } catch (e) {}
            if (!gl) {
                console.warn('Could not initialise WebGL');
            }

            return gl;
        }

        function logGLError() {
            var err = gl.getError();
            if (err !== gl.NO_ERROR) {
                console.warn('WebGL error #' + err);
            }
        }

        function initShaders() {
            shaderDiffuse = new DiffuseShader();
            shaderSphericalMapLM = new SphericalMapLMShader();
            shaderLMTable = new LMTableShader();
        }

        function updateLoadedObjectsCount() {
            var percent,
                $progress = $('#progressLoading');

            loadedItemsCount++;

            percent = Math.floor(loadedItemsCount * 100 / ITEMS_TO_LOAD) + '%';
            $progress
                .css('width', percent)
                .html(percent);

            if (loadedItemsCount >= ITEMS_TO_LOAD) {
                loaded = true;
                console.log('Loaded all assets');
                $('#row-progress').hide();
            }
        }

        function loadETC1WithFallback(url) {
            if (isETC1Supported) {
                return CompressedTextureLoader.loadETC1(url + '.pkm', updateLoadedObjectsCount);
            } else {
                return UncompressedTextureLoader.load(url + '.png', updateLoadedObjectsCount);
            }
        }

        function loadData() {
            textureCoinsNormalMap = UncompressedTextureLoader.load('data/textures/faces/coin' + coinNormalType + '_normal.png', updateLoadedObjectsCount);
            textureSphericalMap = UncompressedTextureLoader.load('data/textures/spheres/sphere_' + coinSphericalMap + '.png', updateLoadedObjectsCount);
            textureCoinsLightMap = loadETC1WithFallback('data/textures/coin' + coinModelType + '_lm');
            textureTable = loadETC1WithFallback('data/textures/table/' + tableTextureType);
            textureTableLM = loadETC1WithFallback('data/textures/table/table_lm_coin' + coinModelType);

            vignette = new VignetteData();
            vignette.initGL(gl);

            mMMatrix = MatrixUtils.mat4.create();
            mVMatrix = MatrixUtils.mat4.create();
            mMVPMatrix = MatrixUtils.mat4.create();
            mProjMatrix = MatrixUtils.mat4.create();

            matOrtho = MatrixUtils.mat4.create();
            MatrixUtils.mat4.ortho(matOrtho, -1, 1, -1, 1, 2.0, 250);

            modelTable = new FullModel();
            modelTable.load('data/models/table', updateLoadedObjectsCount);
            modelCoins = new FullModel();
            modelCoins.load('data/models/coins' + coinModelType, updateLoadedObjectsCount);
        }

        function setTexture2D(textureUnit, textureID, uniformID) {
            gl.activeTexture(gl.TEXTURE0 + textureUnit);
            gl.bindTexture(gl.TEXTURE_2D, textureID);
            gl.uniform1i(uniformID, textureUnit);
        }

        function setTextureCubemap(textureUnit, textureID, uniformID) {
            gl.ActiveTexture(gl.TEXTURE0 + textureUnit);
            gl.BindTexture(gl.TEXTURE_CUBE_MAP, textureID);
            gl.Uniform1i(uniformID, textureUnit);
        }

        function positionCamera(a) {
            var x, y, z,
                sina, cosa;

            x = 0;
            y = 0;
            z = (Math.sin(a * 6.2831852) * 100.0) + 200.0;
            sina = Math.sin(angleYaw / 360.0 * 6.2831852);
            cosa = Math.cos(angleYaw / 360.0 * 6.2831852);
            x = sina * 180.0;
            y = cosa * 180.0;

            MatrixUtils.mat4.identity(mVMatrix);
            MatrixUtils.mat4.lookAt(mVMatrix, [x, y, z], [0, 0, 0], [0, 0, 1]);
        }

        function setCameraFOV(multiplier) {
            var ratio;

            if (gl.viewportHeight > 0) {
                ratio = gl.viewportWidth / gl.viewportHeight;
            } else {
                ratio = 1.0;
            }

            if (gl.viewportWidth >= gl.viewportHeight) {
                setFOV(mProjMatrix, FOV_LANDSCAPE * multiplier, ratio, 20.0, 1000.0);
            } else {
                setFOV(mProjMatrix, FOV_PORTRAIT * multiplier, ratio, 20.0, 1000.0);
            }
        }

        function setFOV(matrix, fovY, aspect, zNear, zFar) {
            var fW, fH;

            fH = Math.tan(fovY / 360.0 * 3.1415926) * zNear;
            fW = fH * aspect;
            MatrixUtils.mat4.frustum(matrix, -fW, fW, -fH, fH, zNear, zFar);
        }

        function drawScene() {
            if (!loaded) {
                return;
            }

            gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            gl.enable(gl.DEPTH_TEST);
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);

            positionCamera(0.0);
            setCameraFOV(1.0);

            drawTable();
            drawCoins();
        }

        function calculateMVPMatrix(tx, ty, tz, rx, ry, rz, sx, sy, sz) {
            MatrixUtils.mat4.identity(mMMatrix);
            MatrixUtils.mat4.rotate(mMMatrix, mMMatrix, 0, [1, 0, 0]);
            MatrixUtils.mat4.translate(mMMatrix, mMMatrix, [tx, ty, tz]);
            MatrixUtils.mat4.scale(mMMatrix, mMMatrix, [sx, sy, sz]);
            MatrixUtils.mat4.rotateX(mMMatrix, mMMatrix, rx);
            MatrixUtils.mat4.rotateY(mMMatrix, mMMatrix, ry);
            MatrixUtils.mat4.rotateZ(mMMatrix, mMMatrix, rz);
            MatrixUtils.mat4.multiply(mMVPMatrix, mVMatrix, mMMatrix);
            MatrixUtils.mat4.multiply(mMVPMatrix, mProjMatrix, mMVPMatrix);
        }

        function drawVignette(texture) {
            shaderDiffuse.use();

            setTexture2D(0, texture, shaderDiffuse.sTexture);

            MatrixUtils.mat4.ortho(matOrtho, -1, 1, -1, 1, 2.0, 250);

            gl.bindBuffer(gl.ARRAY_BUFFER, vignette.buffer);

            gl.vertexAttribPointer(shaderDiffuse.rm_Vertex, 3, gl.FLOAT, false, TRIANGLE_VERTICES_DATA_STRIDE_BYTES, TRIANGLE_VERTICES_DATA_POS_OFFSET * FLOAT_SIZE_BYTES);
            gl.enableVertexAttribArray(shaderDiffuse.rm_Vertex);

            gl.vertexAttribPointer(shaderDiffuse.rm_TexCoord0, 2, gl.FLOAT, false, TRIANGLE_VERTICES_DATA_STRIDE_BYTES, TRIANGLE_VERTICES_DATA_UV_OFFSET * FLOAT_SIZE_BYTES);
            gl.enableVertexAttribArray(shaderDiffuse.rm_TexCoord0);

            gl.uniformMatrix4fv(shaderDiffuse.view_proj_matrix, false, matOrtho);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        function drawTable() {
            shaderLMTable.use();

            setTexture2D(0, textureTable, shaderLMTable.sTexture);
            setTexture2D(1, textureTableLM, shaderLMTable.sLM);
            gl.uniform1f(shaderLMTable.diffuseScale, 8.0);
            drawLMVBOTranslatedRotatedScaled(shaderLMTable, modelTable, 0, 0, 0, 0, 0, 0, 1, 1, 1);
        }

        function drawCoins() {
            shaderSphericalMapLM.use();

            setTexture2D(0, textureCoinsNormalMap, shaderSphericalMapLM.normalMap);
            setTexture2D(1, textureSphericalMap, shaderSphericalMapLM.sphereMap);
            setTexture2D(2, textureCoinsLightMap, shaderSphericalMapLM.aoMap);
            drawCoinVBOTranslatedRotatedScaled(shaderSphericalMapLM, modelCoins, 0, 0, 0, 0, 0, 0, 1, 1, 1);
        }

        function drawCoinVBOTranslatedRotatedScaled(shader, model, tx, ty, tz, rx, ry, rz, sx, sy, sz) {
            model.bindBuffers();

            gl.enableVertexAttribArray(shader.rm_Vertex);
            gl.enableVertexAttribArray(shader.rm_TexCoord0);
            gl.enableVertexAttribArray(shader.rm_TexCoord1);
            gl.enableVertexAttribArray(shader.rm_Normal);

            gl.vertexAttribPointer(shader.rm_Vertex, 3, gl.FLOAT, false, 4 * (3 + 2 + 2 + 3), 0);
            gl.vertexAttribPointer(shader.rm_TexCoord0, 2, gl.FLOAT, false, 4 * (3 + 2 + 2 + 3), 4 * (3));
            gl.vertexAttribPointer(shader.rm_TexCoord1, 2, gl.FLOAT, false, 4 * (3 + 2 + 2 + 3), 4 * (3 + 2));
            gl.vertexAttribPointer(shader.rm_Normal, 3, gl.FLOAT, false, 4 * (3 + 2 + 2 + 3), 4 * (3 + 2 + 2));

            calculateMVPMatrix(tx, ty, tz, rx, ry, rz, sx, sy, sz);

            gl.uniformMatrix4fv(shader.view_matrix, false, mVMatrix);
            gl.uniformMatrix4fv(shader.view_proj_matrix, false, mMVPMatrix);
            gl.drawElements(gl.TRIANGLES, model.getNumIndices() * 3, gl.UNSIGNED_SHORT, 0);
        }

        function drawLMVBOTranslatedRotatedScaled(shader, model, tx, ty, tz, rx, ry, rz, sx, sy, sz) {
            model.bindBuffers();

            gl.enableVertexAttribArray(shader.rm_Vertex);
            gl.enableVertexAttribArray(shader.rm_TexCoord0);
            gl.enableVertexAttribArray(shader.rm_TexCoord1);

            gl.vertexAttribPointer(shader.rm_Vertex, 3, gl.FLOAT, false, 4 * (3 + 2 + 2), 0);
            gl.vertexAttribPointer(shader.rm_TexCoord0, 2, gl.FLOAT, false, 4 * (3 + 2 + 2), 4 * (3));
            gl.vertexAttribPointer(shader.rm_TexCoord1, 2, gl.FLOAT, false, 4 * (3 + 2 + 2), 4 * (3 + 2));

            calculateMVPMatrix(tx, ty, tz, rx, ry, rz, sx, sy, sz);

            gl.uniformMatrix4fv(shader.view_proj_matrix, false, mMVPMatrix);
            gl.drawElements(gl.TRIANGLES, model.getNumIndices() * 3, gl.UNSIGNED_SHORT, 0);
        }

        window.requestAnimFrame = (function() {
            return window.requestAnimationFrame ||
                window.webkitRequestAnimationFrame ||
                window.mozRequestAnimationFrame ||
                window.oRequestAnimationFrame ||
                window.msRequestAnimationFrame ||
                function( /* function FrameRequestCallback */ callback, /* DOMElement Element */ element) {
                    window.setTimeout(callback, 1000 / 60);
                };
        })();

        function tick() {
            requestAnimFrame(tick);
            drawScene();
            animate();
        }

        function animate() {
            var timeNow = new Date().getTime(),
                elapsed;

            if (lastTime != 0) {
                elapsed = timeNow - lastTime;

                angleYaw += elapsed / YAW_COEFF_NORMAL;
                angleYaw %= 360.0;
            }

            lastTime = timeNow;
        }

        $(function() {
            var canvas = document.getElementById('canvasGL');

            $(canvas).show();
            window.gl = initGL(canvas);

            if (window.gl) {
                loadData();
                initShaders();
                tick();
            } else {
                $(canvas).hide();
                $('#alertError').show();
            }
        });
    });
