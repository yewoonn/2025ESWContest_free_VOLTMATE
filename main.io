import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error

# 1️⃣ 배터리 데이터 로드 (NASA 데이터셋 등 사용 가능)
df = pd.read_csv("battery_data.csv")  # 실제 데이터 경로로 변경 필요

# 2️⃣ Feature Engineering (전압 변화율, 내부 저항 증가율 등 추가)
df["voltage_change"] = df["voltage"].diff()
df["resistance_change"] = df["internal_resistance"].diff()
df["temperature_change"] = df["temperature"].diff()
df["charge_efficiency"] = df["capacity"] / df["capacity"].shift(1)

# 결측값 제거
df = df.dropna()

# 3️⃣ 입력 변수 및 예측 대상 설정
features = ["capacity", "voltage", "current", "temperature", "internal_resistance", "cycle",
            "voltage_change", "resistance_change", "temperature_change", "charge_efficiency"]

X = df[features]
y_soh = df["SOH"]  # 배터리 건강 상태 예측
y_soc = df["SOC"]  # 배터리 충전 상태 예측

# 4️⃣ 데이터셋 분할
X_train, X_test, y_soh_train, y_soh_test = train_test_split(X, y_soh, test_size=0.2, random_state=42)
X_train, X_test, y_soc_train, y_soc_test = train_test_split(X, y_soc, test_size=0.2, random_state=42)

# 5️⃣ LightGBM 데이터 변환
train_data_soh = lgb.Dataset(X_train, label=y_soh_train)
train_data_soc = lgb.Dataset(X_train, label=y_soc_train)

# 6️⃣ LightGBM 하이퍼파라미터 설정 (BatteryML 논문 기반으로 최적화 가능)
params = {
    "objective": "regression",
    "metric": "mae",
    "boosting_type": "gbdt",
    "learning_rate": 0.05,
    "num_leaves": 31,
    "max_depth": -1,
    "verbose": -1
}

# 7️⃣ LightGBM 모델 학습 (SOH & SOC 개별 학습)
model_soh = lgb.train(params, train_data_soh, num_boost_round=100)
model_soc = lgb.train(params, train_data_soc, num_boost_round=100)

# 8️⃣ 예측 및 성능 평가
y_soh_pred = model_soh.predict(X_test)
y_soc_pred = model_soc.predict(X_test)

mae_soh = mean_absolute_error(y_soh_test, y_soh_pred)
mae_soc = mean_absolute_error(y_soc_test, y_soc_pred)

print(f"🔹 SOH 예측 MAE: {mae_soh:.3f}")
print(f"🔹 SOC 예측 MAE: {mae_soc:.3f}")

# 9️⃣ 샘플 예측 결과 출력
test_sample = X_test.iloc[:5]
soh_pred_sample = model_soh.predict(test_sample)
soc_pred_sample = model_soc.predict(test_sample)

print("\n🔍 샘플 예측 결과:")
for i in range(5):
    print(f"배터리 {i+1} - 예상 SOH: {soh_pred_sample[i]:.2f}%, 예상 SOC: {soc_pred_sample[i]:.2f}%")


